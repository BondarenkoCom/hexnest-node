import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AgentAdapter, AgentResponse } from "../adapters/AgentAdapter.js";
import { NodeConfig } from "../config.js";
import { HexNestClient, HexNestClientLike } from "../protocol/HexNestClient.js";
import {
  AgentDescriptor,
  HeartbeatPayload,
  NodeApprovalStatusResponse,
  NodeStatus,
  PendingInvitation,
  RegisterNodeRequest,
  RoomContext,
  UsageRecord
} from "../protocol/types.js";
import { CommissionMeter } from "./CommissionMeter.js";
import { Heartbeat } from "./Heartbeat.js";

interface RuntimeLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface NodeRuntimeDependencies {
  clientFactory?: (coreUrl: string, options: { nodeToken?: string; timeoutMs?: number }) => HexNestClientLike;
  logger?: RuntimeLogger;
  uuidFactory?: () => string;
  now?: () => number;
}

// Section 9 Protocol: autonomous field unit with central coordination.
export class NodeRuntime {
  private static readonly MAX_INVITATION_ATTEMPTS = 3;
  private static readonly INVITATION_RETRY_BASE_MS = 2_000;

  private readonly meter = new CommissionMeter();
  private readonly adapters = new Map<string, AgentAdapter>();
  private readonly logger: RuntimeLogger;
  private readonly createClient: (coreUrl: string, options: { nodeToken?: string; timeoutMs?: number }) => HexNestClientLike;
  private readonly makeUuid: () => string;
  private readonly now: () => number;
  private readonly startedAt: number;

  private nodeId: string | null;
  private nodeToken: string | null;
  private heartbeat: Heartbeat | null = null;
  private authedClient: HexNestClientLike | null = null;
  private usageFlushTimer: NodeJS.Timeout | null = null;
  private activeRoomRuns = new Map<string, Promise<void>>();
  private usageSubmitInFlight: Promise<void> | null = null;
  private invitationAttempts = new Map<string, number>();
  private invitationRetryTimers = new Map<string, NodeJS.Timeout>();
  private isRunning = false;
  private stopRequested = false;
  private status: NodeStatus = "offline";

  constructor(
    private readonly config: NodeConfig,
    adapters: AgentAdapter[],
    deps: NodeRuntimeDependencies = {}
  ) {
    this.nodeId = config.nodeId || null;
    this.nodeToken = config.nodeToken || null;
    this.logger = deps.logger ?? console;
    this.createClient = deps.clientFactory ?? ((coreUrl, options) => new HexNestClient(coreUrl, options));
    this.makeUuid = deps.uuidFactory ?? randomUUID;
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();

    for (const adapter of adapters) {
      this.adapters.set(adapter.name, adapter);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    if (this.adapters.size === 0) {
      throw new Error("No adapters configured");
    }
    this.isRunning = true;
    this.stopRequested = false;
    try {
      await this.ensureRegistered();
      if (!this.nodeId || !this.nodeToken) {
        throw new Error("Node identity is missing after registration");
      }

      this.authedClient = this.createClient(this.config.coreUrl, {
        nodeToken: this.nodeToken,
        timeoutMs: this.config.httpTimeoutMs
      });
      await this.waitUntilApproved();
      this.status = "online";

      this.heartbeat = new Heartbeat(
        this.authedClient,
        this.nodeId,
        this.config.heartbeatIntervalMs,
        () => this.buildHeartbeatPayload(),
        async (response) => {
          await this.processInvitations(response.pendingInvitations || []);
        },
        this.logger
      );
      this.heartbeat.start(true);

      this.usageFlushTimer = setInterval(() => {
        void this.flushUsage("periodic").catch((error) => {
          this.logger.error("[node] periodic usage flush failed:", this.err(error));
        });
      }, this.config.usageFlushIntervalMs);

      this.logger.info(
        `[node] started id=${this.nodeId} adapters=${this.adapters.size} heartbeatMs=${this.config.heartbeatIntervalMs}`
      );
    } catch (error) {
      this.isRunning = false;
      this.status = "offline";
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.stopRequested = true;
    this.status = "draining";

    if (this.usageFlushTimer) {
      clearInterval(this.usageFlushTimer);
      this.usageFlushTimer = null;
    }

    this.heartbeat?.stop();
    this.heartbeat = null;
    for (const timer of this.invitationRetryTimers.values()) {
      clearTimeout(timer);
    }
    this.invitationRetryTimers.clear();
    this.invitationAttempts.clear();

    await this.waitForActiveRooms(this.config.shutdownGraceMs);
    await this.flushUsage("shutdown");

    if (this.nodeId && this.authedClient) {
      try {
        await this.authedClient.markOffline(this.nodeId);
      } catch (error) {
        this.logger.warn("[node] failed to mark offline:", this.err(error));
      }
    }

    this.status = "offline";
    this.isRunning = false;
    this.logger.info("[node] stopped");
  }

  async handleRoomInvitation(roomId: string, role: string, taskHint = ""): Promise<void> {
    if (!this.isRunning) {
      throw new Error("Node is not running");
    }
    if (this.stopRequested || this.status === "draining") {
      this.logger.warn(`[node] skipping invitation room=${roomId}, node is draining`);
      return;
    }
    if (this.activeRoomRuns.has(roomId)) return;

    const run = this.runRoomInvitation(roomId, role, taskHint).finally(() => {
      this.activeRoomRuns.delete(roomId);
      this.refreshStatus();
    });
    this.activeRoomRuns.set(roomId, run);
    this.refreshStatus();
    return run;
  }

  getState(): {
    isRunning: boolean;
    status: NodeStatus;
    activeRooms: string[];
    nodeId: string | null;
    hasToken: boolean;
  } {
    return {
      isRunning: this.isRunning,
      status: this.status,
      activeRooms: [...this.activeRoomRuns.keys()],
      nodeId: this.nodeId,
      hasToken: Boolean(this.nodeToken)
    };
  }

  private async ensureRegistered(): Promise<void> {
    if (this.nodeId && this.nodeToken) return;
    const registrationClient = this.createClient(this.config.coreUrl, {
      timeoutMs: this.config.httpTimeoutMs
    });
    const capabilities = this.getAvailableAgents().flatMap((agent) => agent.capabilities);
    const payload: RegisterNodeRequest = {
      name: this.config.nodeName,
      operatorName: this.config.operatorName,
      operatorEmail: this.config.operatorEmail,
      callbackUrl: this.config.callbackUrl,
      agentCapabilities: [...new Set(capabilities)]
    };
    const registration = await registrationClient.registerNode(payload);
    this.nodeId = registration.nodeId;
    this.nodeToken = registration.nodeToken;
    await this.persistIdentity(registration.nodeId, registration.nodeToken);
    this.logger.info(`[node] registered id=${this.nodeId} status=${registration.status}`);
  }

  private async runRoomInvitation(roomId: string, role: string, taskHint = ""): Promise<void> {
    if (!this.authedClient) {
      throw new Error("Authenticated client is not initialized");
    }

    const adapter = this.pickAdapterForInvitation(role, taskHint);
    this.logger.info(`[node] handling room=${roomId} role=${role} adapter=${adapter.name}`);

    const joined = await this.authedClient.joinRoom(roomId, adapter.name, role);
    const context = await this.authedClient.getRoomContext(roomId, role);
    const response = await adapter.respond(context);
    await this.authedClient.postRoomMessage(this.buildPostMessagePayload(context.roomId, joined.joinedAgent.id, response));

    const usage = await this.buildUsageRecord(adapter, context, response.text, role);
    this.meter.track(usage);

    if (this.meter.getSnapshot().pendingUsageRecords >= this.config.maxUsageBatch) {
      await this.flushUsage("threshold");
    }
  }

  private buildPostMessagePayload(roomId: string, joinedAgentId: string, response: AgentResponse) {
    const text = this.decorateResponseText(response);
    return {
      roomId,
      joinedAgentId,
      text,
      confidence: response.confidence,
      artifacts: response.artifacts,
      pythonCode: response.pythonCode,
      needHuman: response.needHuman
    };
  }

  private decorateResponseText(response: AgentResponse): string {
    if (!response.pythonCode) return response.text;
    return `${response.text}\n\nPython snippet:\n\`\`\`python\n${response.pythonCode}\n\`\`\``;
  }

  private pickAdapterForInvitation(role: string, taskHint: string): AgentAdapter {
    const normalizedRole = role.toLowerCase();
    const normalizedTask = taskHint.toLowerCase();
    const adapters = [...this.adapters.values()];
    if (adapters.length === 0) {
      throw new Error("No adapters configured");
    }

    let best = adapters[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const adapter of adapters) {
      let score = 0;
      if (adapter.supportedRoles.map((r) => r.toLowerCase()).includes(normalizedRole)) {
        score += 100;
      }
      for (const capability of adapter.capabilities) {
        if (normalizedTask.includes(capability.toLowerCase())) score += 8;
      }
      if (adapter.name.toLowerCase().includes("local")) score += 1;
      if (score > bestScore) {
        best = adapter;
        bestScore = score;
      }
    }
    return best;
  }

  private async processInvitations(invitations: PendingInvitation[]): Promise<void> {
    if (!this.config.autoAcceptInvites || invitations.length === 0) return;
    if (this.stopRequested || this.status === "draining") return;

    const sorted = [...invitations].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    for (const invitation of sorted) {
      if (!invitation.roomId || !invitation.role) continue;
      this.dispatchInvitationWithRetry(invitation);
    }
  }

  private dispatchInvitationWithRetry(invitation: PendingInvitation): void {
    const key = this.invitationKey(invitation.roomId, invitation.role);
    if (this.activeRoomRuns.has(invitation.roomId)) {
      return;
    }
    if (this.invitationRetryTimers.has(key)) {
      return;
    }

    const nextAttempt = (this.invitationAttempts.get(key) || 0) + 1;
    this.invitationAttempts.set(key, nextAttempt);

    void this.handleRoomInvitation(invitation.roomId, invitation.role, invitation.task || "")
      .then(() => {
        this.invitationAttempts.delete(key);
        const timer = this.invitationRetryTimers.get(key);
        if (timer) {
          clearTimeout(timer);
          this.invitationRetryTimers.delete(key);
        }
      })
      .catch((error) => {
        if (this.stopRequested || this.status === "draining") {
          this.logger.warn(
            `[node] invitation dropped while draining room=${invitation.roomId} role=${invitation.role}`
          );
          return;
        }

        if (nextAttempt >= NodeRuntime.MAX_INVITATION_ATTEMPTS) {
          this.invitationAttempts.delete(key);
          this.logger.error(
            `[node] invitation failed room=${invitation.roomId} role=${invitation.role} attempts=${nextAttempt}:`,
            this.err(error)
          );
          return;
        }

        const delayMs = NodeRuntime.INVITATION_RETRY_BASE_MS * 2 ** (nextAttempt - 1);
        this.logger.warn(
          `[node] invitation retry scheduled room=${invitation.roomId} role=${invitation.role} attempt=${nextAttempt + 1} in ${delayMs}ms`
        );
        const timer = setTimeout(() => {
          this.invitationRetryTimers.delete(key);
          this.dispatchInvitationWithRetry(invitation);
        }, delayMs);
        if (typeof timer.unref === "function") {
          timer.unref();
        }
        this.invitationRetryTimers.set(key, timer);
      });
  }

  private invitationKey(roomId: string, role: string): string {
    return `${roomId}::${role}`;
  }

  private async waitUntilApproved(): Promise<void> {
    if (!this.authedClient || !this.nodeId) {
      throw new Error("Authenticated client is not initialized");
    }

    let statusPayload: NodeApprovalStatusResponse | null = null;
    while (!this.stopRequested) {
      statusPayload = await this.authedClient.getNodeStatus(this.nodeId);
      const approvalStatus = statusPayload.approvalStatus;
      if (approvalStatus === "approved") {
        if (statusPayload.lastHeartbeatStatus === "online" || statusPayload.lastHeartbeatStatus === "busy") {
          this.status = statusPayload.lastHeartbeatStatus;
        }
        return;
      }
      if (approvalStatus === "suspended" || approvalStatus === "rejected") {
        throw new Error(`node is ${approvalStatus}; startup halted`);
      }

      this.logger.info(
        `[node] waiting for approval node=${this.nodeId} status=${approvalStatus}; retry in ${this.config.approvalPollIntervalMs}ms`
      );
      await this.sleep(this.config.approvalPollIntervalMs);
    }

    throw new Error("startup interrupted while waiting for node approval");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(50, ms)));
  }

  private async persistIdentity(nodeId: string, nodeToken: string): Promise<void> {
    const identityPath = this.config.identityPath;
    if (!identityPath) {
      return;
    }
    try {
      await fs.mkdir(path.dirname(identityPath), { recursive: true });
      await fs.writeFile(
        identityPath,
        JSON.stringify({ nodeId, nodeToken, updatedAt: new Date(this.now()).toISOString() }, null, 2),
        "utf8"
      );
      this.logger.info(`[node] identity saved: ${identityPath}`);
    } catch (error) {
      this.logger.warn(`[node] failed to persist identity at ${identityPath}: ${this.err(error)}`);
    }
  }

  private async waitForActiveRooms(timeoutMs: number): Promise<void> {
    if (this.activeRoomRuns.size === 0) return;

    const deadline = this.now() + Math.max(500, timeoutMs);
    while (this.activeRoomRuns.size > 0 && this.now() < deadline) {
      const inflight = [...this.activeRoomRuns.values()];
      await Promise.race([
        Promise.allSettled(inflight),
        new Promise((resolve) => setTimeout(resolve, 200))
      ]);
    }

    if (this.activeRoomRuns.size > 0) {
      this.logger.warn(
        `[node] shutdown timeout with active rooms still running: ${[...this.activeRoomRuns.keys()].join(", ")}`
      );
    }
  }

  private async flushUsage(reason: "periodic" | "threshold" | "shutdown"): Promise<void> {
    if (!this.authedClient || !this.nodeId) return;
    if (this.usageSubmitInFlight) {
      await this.usageSubmitInFlight;
      return;
    }
    this.usageSubmitInFlight = this.executeUsageSubmit(reason);
    try {
      await this.usageSubmitInFlight;
    } finally {
      this.usageSubmitInFlight = null;
    }
  }

  private async executeUsageSubmit(reason: "periodic" | "threshold" | "shutdown"): Promise<void> {
    if (!this.authedClient || !this.nodeId) return;
    const pendingBefore = this.meter.getSnapshot().pendingUsageRecords;
    if (pendingBefore === 0) return;
    const result = await this.meter.submit(this.authedClient, this.nodeId, this.config.maxUsageBatch);
    this.logger.info(
      `[node] usage submit reason=${reason} accepted=${result.accepted} pendingBefore=${pendingBefore} totalOwed=${result.totalOwed}`
    );
  }

  private buildHeartbeatPayload(): HeartbeatPayload {
    const meter = this.meter.getSnapshot();
    return {
      nodeId: this.nodeId || undefined,
      status: this.status,
      availableAgents: this.getAvailableAgents(),
      activeRooms: [...this.activeRoomRuns.keys()],
      meter: {
        totalTokensUsed: meter.totalTokensUsed,
        totalRoomsJoined: meter.totalRoomsJoined,
        totalEstimatedCostUsd: meter.totalEstimatedCostUsd,
        uptimeSec: Math.floor((this.now() - this.startedAt) / 1000),
        pendingUsageRecords: meter.pendingUsageRecords
      }
    };
  }

  private getAvailableAgents(): AgentDescriptor[] {
    return [...this.adapters.values()].map((adapter) => ({
      name: adapter.name,
      capabilities: adapter.capabilities,
      supportedRoles: adapter.supportedRoles
    }));
  }

  private refreshStatus(): void {
    if (this.stopRequested) {
      this.status = "draining";
      return;
    }
    this.status = this.activeRoomRuns.size > 0 ? "busy" : "online";
  }

  private async buildUsageRecord(
    adapter: AgentAdapter,
    context: RoomContext,
    responseText: string,
    role: string
  ): Promise<UsageRecord> {
    const cost = await adapter.estimateCost(context, responseText);
    return {
      id: this.makeUuid(),
      roomId: context.roomId,
      agentName: adapter.name,
      role,
      model: adapter.modelId,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      estimatedCostUsd: cost.estimatedCostUsd,
      recordedAt: new Date(this.now()).toISOString()
    };
  }

  private err(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
