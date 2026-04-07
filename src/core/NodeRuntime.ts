import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AgentAdapter, AgentResponse } from "../adapters/AgentAdapter.js";
import { NodeConfig } from "../config.js";
import { CoreApiError, HexNestClient, HexNestClientLike, isCoreApiError } from "../protocol/HexNestClient.js";
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
import { DatabaseService } from "../db/database.js";

interface RuntimeLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface RuntimeActivityItem {
  type: "info" | "success" | "warn" | "error";
  message: string;
  timestamp: string;
}

class CoreConnectionSupersededError extends Error {
  constructor() {
    super("core connection attempt was superseded");
    this.name = "CoreConnectionSupersededError";
  }
}

export interface NodeRuntimeDependencies {
  clientFactory?: (coreUrl: string, options: { nodeToken?: string; userToken?: string; timeoutMs?: number }) => HexNestClientLike;
  logger?: RuntimeLogger;
  uuidFactory?: () => string;
  now?: () => number;
  database?: DatabaseService;
}

// Section 9 Protocol: autonomous field unit with central coordination.
export class NodeRuntime {
  private static readonly MAX_INVITATION_ATTEMPTS = 3;
  private static readonly INVITATION_RETRY_BASE_MS = 2_000;

  private readonly meter = new CommissionMeter();
  private readonly adapters = new Map<string, AgentAdapter>();
  private readonly logger: RuntimeLogger;
  private readonly createClient: (coreUrl: string, options: { nodeToken?: string; userToken?: string; timeoutMs?: number }) => HexNestClientLike;
  private readonly makeUuid: () => string;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly database: DatabaseService | null;

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
  private coreConnected = false;
  private lastHeartbeatAt: number | null = null;
  private lastCoreError: string | null = null;
  private coreConnectionGeneration = 0;
  private readonly recentActivity: RuntimeActivityItem[] = [];

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
    this.database = deps.database ?? null;

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
      // Try to connect to core, but allow offline operation
      try {
        await this.connectToCore();
      } catch (coreError) {
        if (!(coreError instanceof CoreConnectionSupersededError)) {
          this.enterLocalMode(coreError);
        }
      }

      this.usageFlushTimer = setInterval(() => {
        void this.flushUsage("periodic").catch((error) => {
          this.logger.error("[node] periodic usage flush failed:", this.err(error));
        });
      }, this.config.usageFlushIntervalMs);

      this.logger.info(
        `[node] ready node=${this.config.nodeName} adapters=${this.adapters.size} status=${this.status}`
      );
      this.recordActivity(
        "success",
        `Node runtime started with ${this.adapters.size} configured adapter${this.adapters.size === 1 ? "" : "s"}`
      );
    } catch (error) {
      this.isRunning = false;
      this.status = "offline";
      throw error;
    }
  }

  async reconnectToCore(
    auth?: { userToken?: string; userEmail?: string }
  ): Promise<{ coreUrl: string; coreConnected: boolean; nodeId: string | null }> {
    if (!this.isRunning) {
      throw new Error("Node runtime is not running");
    }

    const providedUserToken = auth?.userToken?.trim();
    const providedUserEmail = auth?.userEmail?.trim();
    if (providedUserToken) {
      this.config.userToken = providedUserToken;
      this.database?.setNodeConfig("user_token", providedUserToken);
    }
    if (providedUserEmail) {
      this.config.userEmail = providedUserEmail;
      this.database?.setNodeConfig("user_email", providedUserEmail);
    }

    if (!this.config.coreUrl) {
      throw new Error("Core connection is not configured in node settings");
    }

    await this.disconnectFromCore(false);
    if (providedUserToken && this.nodeId && this.nodeToken && !this.coreConnected) {
      await this.resetLocalIdentity("refreshing pending node identity after user auth");
    }

    try {
      await this.connectToCore();
    } catch (error) {
      this.enterLocalMode(error);
      throw error;
    }

    return {
      coreUrl: this.config.coreUrl,
      coreConnected: this.coreConnected,
      nodeId: this.nodeId
    };
  }

  async removeCurrentNodeFromCore(): Promise<{ removed: boolean; nodeId: string | null }> {
    const currentNodeId = this.nodeId;
    if (!currentNodeId) {
      await this.resetLocalIdentity("node is already detached from core");
      return { removed: false, nodeId: null };
    }

    const userToken = this.resolveUserToken();
    if (!userToken) {
      throw new Error("User token is required to remove this node from core");
    }

    const client = this.createClient(this.config.coreUrl, {
      userToken,
      timeoutMs: this.config.httpTimeoutMs
    });

    try {
      await client.deleteNode(currentNodeId);
    } catch (error) {
      if (!(isCoreApiError(error) && error.details.status === 404)) {
        throw error;
      }
    }

    await this.resetLocalIdentity(`node removed from core id=${currentNodeId}`);
    this.enterLocalMode(new Error("node removed from core"));
    this.recordActivity("warn", `Removed node ${currentNodeId} from HexNest Core`);
    return { removed: true, nodeId: currentNodeId };
  }

  async disconnectFromCoreByOperator(): Promise<{ coreUrl: string; coreConnected: boolean; nodeId: string | null }> {
    if (!this.isRunning) {
      throw new Error("Node runtime is not running");
    }

    await this.disconnectFromCore(true);
    this.lastCoreError = "Disconnected by operator from node manager";
    this.status = "offline";
    this.recordActivity("warn", "Disconnected from HexNest Core by operator");

    return {
      coreUrl: this.config.coreUrl,
      coreConnected: this.coreConnected,
      nodeId: this.nodeId
    };
  }

  async resetNodeIdentityByOperator(): Promise<{ previousNodeId: string | null }> {
    if (!this.isRunning) {
      throw new Error("Node runtime is not running");
    }

    const previousNodeId = this.nodeId;
    await this.disconnectFromCore(true);
    await this.resetLocalIdentity("identity reset by operator from node manager");
    this.enterLocalMode(new Error("node identity reset by operator"));
    this.recordActivity(
      "warn",
      previousNodeId
        ? `Reset local node identity for ${previousNodeId}; next reconnect will register a new node`
        : "Cleared local node identity; next reconnect will register a new node"
    );

    return { previousNodeId };
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
    this.recordActivity("info", "Node runtime stopped");
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
      nodeToken: undefined,
      userToken: this.resolveUserToken(),
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
    this.recordActivity(
      registration.status === "approved" ? "success" : "info",
      `Registered node ${registration.nodeId} with core status ${registration.status}`
    );
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

  private async waitUntilApproved(expectedGeneration: number): Promise<void> {
    if (!this.authedClient || !this.nodeId) {
      throw new Error("Authenticated client is not initialized");
    }

    let statusPayload: NodeApprovalStatusResponse | null = null;
    while (!this.stopRequested) {
      if (expectedGeneration !== this.coreConnectionGeneration) {
        throw new CoreConnectionSupersededError();
      }

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

  private resolveUserToken(): string | undefined {
    return this.config.userToken || this.database?.getNodeConfig("user_token") || undefined;
  }

  private async connectToCore(): Promise<void> {
    try {
      await this.connectToCoreOnce();
      return;
    } catch (error) {
      if (!(await this.resetRejectedInitialIdentity(error))) {
        throw error;
      }
    }

    await this.connectToCoreOnce();
  }

  private async connectToCoreOnce(): Promise<void> {
    const generation = ++this.coreConnectionGeneration;
    await this.ensureRegistered();
    if (!this.nodeId || !this.nodeToken) {
      throw new Error("Node identity is missing after registration");
    }

    this.authedClient = this.createClient(this.config.coreUrl, {
      nodeToken: this.nodeToken,
      timeoutMs: this.config.httpTimeoutMs
    });
    await this.waitUntilApproved(generation);
    this.coreConnected = true;
    this.status = "online";
    this.lastCoreError = null;
    this.recordActivity("success", `Connected to HexNest Core as ${this.nodeId}`);

    this.heartbeat?.stop();
    this.heartbeat = new Heartbeat(
      this.authedClient,
      this.nodeId,
      this.config.heartbeatIntervalMs,
      () => this.buildHeartbeatPayload(),
      async (response) => {
        this.lastHeartbeatAt = this.now();
        await this.processInvitations(response.pendingInvitations || []);
      },
      async (error) => {
        await this.handleCoreNodeDeletion(error, "heartbeat");
      },
      this.logger
    );
    this.heartbeat.start(true);
  }

  private async resetRejectedInitialIdentity(error: unknown): Promise<boolean> {
    if (!this.nodeId || !this.nodeToken || !isCoreApiError(error)) {
      return false;
    }

    const status = Number(error.details.status || 0);
    if (status !== 401 && status !== 404) {
      return false;
    }

    await this.resetLocalIdentity(`core rejected startup identity with status=${status}`);
    return true;
  }

  private async disconnectFromCore(clearHeartbeatState = false): Promise<void> {
    this.coreConnectionGeneration += 1;
    this.heartbeat?.stop();
    this.heartbeat = null;

    if (this.coreConnected && this.nodeId && this.authedClient) {
      try {
        await this.authedClient.markOffline(this.nodeId);
      } catch (error) {
        this.logger.warn("[node] failed to mark offline during reconnect:", this.err(error));
      }
    }

    this.authedClient = null;
    this.coreConnected = false;
    if (clearHeartbeatState) {
      this.lastHeartbeatAt = null;
    }
    if (!this.stopRequested) {
      this.status = "offline";
    }
  }

  private enterLocalMode(coreError: unknown): void {
    this.lastCoreError = coreError instanceof Error ? coreError.message : String(coreError);
    this.coreConnected = false;
    this.authedClient = null;
    this.heartbeat?.stop();
    this.heartbeat = null;
    this.logger.warn(
      `[node] failed to connect to core: ${this.lastCoreError}`
    );
    this.logger.warn(`[node] operating in local mode - web UI is available at http://localhost:${process.env.HEXNEST_WEB_PORT || 3000}`);
    this.status = "offline";
    this.recordActivity("warn", `Node is operating in local mode: ${this.lastCoreError}`);
  }

  private async persistIdentity(nodeId: string, nodeToken: string): Promise<void> {
    // Save to database if available
    if (this.database) {
      try {
        this.database.setNodeIdentity(nodeId, nodeToken);
        this.logger.info(`[node] identity saved to database: id=${nodeId}`);
      } catch (error) {
        this.logger.warn(`[node] failed to persist identity to database: ${this.err(error)}`);
      }
    }

    // Also save to filesystem for backward compatibility
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
    let result;
    try {
      result = await this.meter.submit(this.authedClient, this.nodeId, this.config.maxUsageBatch);
    } catch (error) {
      if (await this.handleCoreNodeDeletion(error, "usage submit")) {
        return;
      }
      throw error;
    }
    this.logger.info(
      `[node] usage submit reason=${reason} accepted=${result.accepted} pendingBefore=${pendingBefore} totalOwed=${result.totalOwed}`
    );
  }

  private async handleCoreNodeDeletion(error: unknown, operation: string): Promise<boolean> {
    if (!isCoreApiError(error)) {
      return false;
    }

    const status = Number(error.details.status || 0);
    if (status !== 401 && status !== 404) {
      return false;
    }

    await this.resetLocalIdentity(`core rejected ${operation} with status=${status}`);
    this.enterLocalMode(new Error(`node access removed from core during ${operation}`));
    return true;
  }

  private recordActivity(type: RuntimeActivityItem["type"], message: string): void {
    this.recentActivity.unshift({
      type,
      message,
      timestamp: new Date(this.now()).toISOString()
    });
    if (this.recentActivity.length > 20) {
      this.recentActivity.length = 20;
    }
  }

  private async resetLocalIdentity(reason: string): Promise<void> {
    const previousNodeId = this.nodeId;
    this.heartbeat?.stop();
    this.heartbeat = null;
    this.authedClient = null;
    this.coreConnected = false;
    this.lastHeartbeatAt = null;
    this.nodeId = null;
    this.nodeToken = null;
    this.database?.clearNodeIdentity();
    await this.removePersistedIdentityFile();
    this.logger.warn(`[node] local identity cleared: ${reason}${previousNodeId ? ` node=${previousNodeId}` : ""}`);
    this.recordActivity(
      "warn",
      previousNodeId
        ? `Cleared local node identity ${previousNodeId}: ${reason}`
        : `Cleared local node identity: ${reason}`
    );
  }

  private async removePersistedIdentityFile(): Promise<void> {
    const identityPath = this.config.identityPath;
    if (!identityPath) {
      return;
    }

    try {
      await fs.rm(identityPath, { force: true });
    } catch (error) {
      this.logger.warn(`[node] failed to remove identity file ${identityPath}: ${this.err(error)}`);
    }
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

  async registerUser(email: string, password: string, name: string): Promise<{ userId: string; token: string }> {
    const registrationClient = this.createClient(this.config.coreUrl, {
      timeoutMs: this.config.httpTimeoutMs
    });
    const response = await registrationClient.registerUser({ email, password, name });
    this.logger.info(`[node] user registered email=${email} userId=${response.userId}`);
    this.recordActivity("success", `Registered operator account ${email}`);
    return { userId: response.userId, token: response.token };
  }

  async loginUser(email: string, password: string): Promise<{ userId: string; token: string }> {
    const loginClient = this.createClient(this.config.coreUrl, {
      timeoutMs: this.config.httpTimeoutMs
    });
    const response = await loginClient.loginUser({ email, password });
    this.logger.info(`[node] user logged in email=${email} userId=${response.userId}`);
    this.recordActivity("info", `Authenticated operator ${email}`);
    return { userId: response.userId, token: response.token };
  }

  getRecentActivity(): RuntimeActivityItem[] {
    return [...this.recentActivity];
  }

  getNodeStatus() {
    const meter = this.meter.getSnapshot();
    return {
      id: this.nodeId,
      isRunning: this.isRunning,
      uptime: this.now() - this.startedAt,
      adaptersCount: this.adapters.size,
      coreConnected: this.coreConnected,
      coreConnectionReason: this.lastCoreError,
      runtimeStatus: this.status,
      heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      lastHeartbeatAt: this.lastHeartbeatAt ? new Date(this.lastHeartbeatAt).toISOString() : null,
      activeRoomsCount: this.activeRoomRuns.size,
      pendingUsageRecords: meter.pendingUsageRecords
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
