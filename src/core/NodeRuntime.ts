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
import { RoomAgentSession } from "./RoomAgentSession.js";

interface RuntimeLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface RuntimeActivityItem {
  id: string;
  type: "info" | "success" | "warn" | "error";
  message: string;
  timestamp: string;
}

interface RuntimeLoopMetrics {
  actedCycles: number;
  noActionCycles: number;
  reentryWithoutProgress: number;
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
  private roomStopRequests = new Set<string>();
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
  private readonly loopMetrics: RuntimeLoopMetrics = {
    actedCycles: 0,
    noActionCycles: 0,
    reentryWithoutProgress: 0
  };

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

  public async start(): Promise<void> {
    this.logger.info(`[node] starting runtime node=${this.config.nodeName}...`);
    
    // Quick health check for model adapters (e.g. Ollama)
    void (async () => {
      const urlsToCheck = new Set<string>();
      for (const adapter of this.adapters.values()) {
        if (adapter.baseUrl) {
          urlsToCheck.add(adapter.baseUrl);
        }
      }

      for (const baseUrl of urlsToCheck) {
        try {
          // Use /api/tags for Ollama providers, otherwise check base URL
          const healthUrl = baseUrl.includes("11434") ? `${baseUrl}/api/tags` : baseUrl;
          const response = await fetch(healthUrl).catch(() => null);
          if (!response || !response.ok) {
            this.logger.warn(`[node] WARNING: Model service at ${baseUrl} appears to be offline or unreachable.`);
          } else {
            this.logger.info(`[node] Model service at ${baseUrl} is online and responsive.`);
          }
        } catch (e) {
          // Ignore check failure
        }
      }
    })();

    if (this.config.manualRegistrationOnly) {
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
    return this.startRoomRun(roomId, () => this.runRoomInvitation(roomId, role, taskHint));
  }

  async startManualRoomSession(
    roomId: string,
    agentName: string,
    role: string,
    joinedAgentId: string,
    taskHint = ""
  ): Promise<{ started: boolean; alreadyRunning: boolean }> {
    if (!this.isRunning) {
      throw new Error("Node is not running");
    }
    if (!this.authedClient || !this.coreConnected) {
      throw new Error("Node runtime is not connected to core");
    }
    if (this.stopRequested || this.status === "draining") {
      throw new Error("Node is draining and cannot start room sessions");
    }

    const adapter = this.adapters.get(agentName);
    if (!adapter) {
      throw new Error(`Unknown runtime adapter: ${agentName}`);
    }

    const modelConfig = this.database?.getModelConfig(agentName) || null;
    if (modelConfig && !modelConfig.enabled) {
      throw new Error(`Agent ${agentName} is disabled`);
    }
    if (!String(joinedAgentId || "").trim()) {
      throw new Error("joinedAgentId is required to start a room session");
    }

    const normalizedRole = String(role || "").trim();
    const runtimeRole = normalizedRole || "participant";
    const autonomous = modelConfig?.agentMode === "autonomous";

    const alreadyRunning = this.activeRoomRuns.has(roomId);

    const seededState = this.database?.upsertRoomSession({
      roomId,
      agentName,
      role: normalizedRole,
      joinedAgentId,
      lastSeenMessageId: this.database?.getRoomSession(roomId, agentName)?.lastSeenMessageId,
      lastRespondedMessageId: this.database?.getRoomSession(roomId, agentName)?.lastRespondedMessageId,
      lastRespondedAt: this.database?.getRoomSession(roomId, agentName)?.lastRespondedAt,
      autonomous,
      status: "joined"
    }) || null;

    const run = this.startRoomRun(roomId, () => this.runRoomSession(roomId, runtimeRole, taskHint, adapter, seededState, autonomous));
    return {
      started: Boolean(run),
      alreadyRunning
    };
  }

  async stopManualRoomSession(
    roomId: string,
    agentName: string
  ): Promise<{ stopped: boolean; hadActiveRun: boolean }> {
    if (!this.isRunning) {
      throw new Error("Node is not running");
    }

    const existingSession = this.database?.getRoomSession(roomId, agentName);
    if (!existingSession) {
      return { stopped: false, hadActiveRun: false };
    }

    const activeRun = this.activeRoomRuns.get(roomId);
    const hadActiveRun = Boolean(activeRun);
    this.roomStopRequests.add(roomId);
    this.database?.upsertRoomSession({
      ...existingSession,
      status: "stopped",
      autonomous: false,
      updatedAt: this.now()
    });

    if (activeRun) {
      try {
        await activeRun;
      } catch {
        // Keep stop semantics simple here; state is already persisted below.
      }
    }

    this.database?.upsertRoomSession({
      ...existingSession,
      status: "stopped",
      autonomous: false,
      updatedAt: this.now()
    });
    this.recordActivity("warn", `Stopped room session for ${agentName} in room ${roomId}`);
    return { stopped: true, hadActiveRun };
  }

  async restartManualRoomSession(
    roomId: string,
    agentName: string,
    taskHint = "manual room restart"
  ): Promise<{ started: boolean; alreadyRunning: boolean }> {
    if (!this.isRunning) {
      throw new Error("Node is not running");
    }

    const existingSession = this.database?.getRoomSession(roomId, agentName);
    if (!existingSession) {
      throw new Error(`No room session found for ${agentName} in ${roomId}`);
    }

    const modelConfig = this.database?.getModelConfig(agentName) || null;
    if (modelConfig && !modelConfig.enabled) {
      throw new Error(`Agent ${agentName} is disabled`);
    }
    if (modelConfig?.agentMode === "manual") {
      throw new Error(`Agent ${agentName} is in manual mode and cannot restart an autonomous room session`);
    }
    if (!String(existingSession.joinedAgentId || "").trim()) {
      throw new Error(`Room session for ${agentName} has no joined agent id`);
    }

    await this.stopManualRoomSession(roomId, agentName);
    
    const refreshed = this.database?.getRoomSession(roomId, agentName) || existingSession;
    this.logger.info(`[node] requesting fresh join for restart room=${roomId} agent=${agentName}`);
    
    if (!this.authedClient) throw new Error("Client not connected");
    const joined = await this.authedClient.joinRoom(roomId, agentName, refreshed.role);
    
    // prominent logging
    console.log("====================================================================");
    this.logger.info(`[DIAGNOSTIC] Join Response for ${agentName}: ${JSON.stringify(joined)}`);
    console.log("====================================================================");
    
    // Try to find the agent object in common locations
    const agentData = (joined as any)?.agent || (joined as any)?.joinedAgent || (joined as any)?.data?.agent || (joined as any)?.data?.joinedAgent;
    const agentId = agentData?.id || (joined as any)?.id || (joined as any)?.data?.id;

    if (!agentId) {
      throw new Error(`Failed to join room: Core API response missing agent ID. Response: ${JSON.stringify(joined)}`);
    }
    
    return this.startManualRoomSession(
      roomId,
      agentName,
      refreshed.role,
      agentId,
      taskHint
    );
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
    const capabilities = this.buildAvailableAgents().flatMap((agent) => agent.capabilities);
    const payload: RegisterNodeRequest = {
      name: this.config.nodeName,
      operatorName: this.config.operatorName,
      operatorEmail: this.config.operatorEmail,
      callbackUrl: this.config.callbackUrl,
      agentCapabilities: [...new Set(capabilities)]
    };
    let registration;
    try {
      registration = await registrationClient.registerNode(payload);
    } catch (error) {
      const message = this.err(error).toLowerCase();
      if (
        message.includes("authentication required") ||
        message.includes("unauthorized") ||
        message.includes("401")
      ) {
        throw new Error("Node registration requires account JWT. Run `npx hexnest-node setup` first.");
      }
      throw error;
    }
    this.nodeId = registration.nodeId;
    this.nodeToken = registration.nodeToken;
    await this.persistIdentity(registration.nodeId, registration.nodeToken);
    this.logger.info(`[node] registered id=${this.nodeId} status=${registration.status}`);
    this.recordActivity(
      registration.status === "approved" ? "success" : "info",
      `Registered node ${registration.nodeId} with core status ${registration.status}`
    );
  }

  private startRoomRun(roomId: string, factory: () => Promise<void>): Promise<void> | undefined {
    if (this.activeRoomRuns.has(roomId)) {
      return undefined;
    }

    this.roomStopRequests.delete(roomId);

    const run = factory()
      .catch((error) => {
        const message = this.err(error);
        this.logger.error(`[node] room session failed room=${roomId}: ${message}`);
        this.recordActivity("error", `Room session failed for ${roomId}: ${message}`);
      })
      .finally(() => {
        this.activeRoomRuns.delete(roomId);
        this.roomStopRequests.delete(roomId);
        this.refreshStatus();
      });
    this.activeRoomRuns.set(roomId, run);
    this.refreshStatus();
    return run;
  }

  private async runRoomInvitation(roomId: string, role: string, taskHint = ""): Promise<void> {
    if (!this.authedClient) {
      throw new Error("Authenticated client is not initialized");
    }

    const adapter = this.pickAdapterForInvitation(role, taskHint);
    const modelConfig = this.database?.getModelConfig(adapter.name) || null;
    const existingSession = this.database?.getRoomSession(roomId, adapter.name) || null;
    const autonomous = modelConfig?.agentMode === "autonomous";
    this.logger.info(`[node] handling room=${roomId} role=${role} adapter=${adapter.name}`);

    await this.runRoomSession(roomId, role, taskHint, adapter, existingSession, autonomous);
  }

  private async runRoomSession(
    roomId: string,
    role: string,
    taskHint: string,
    adapter: AgentAdapter,
    existingSession = this.database?.getRoomSession(roomId, adapter.name) || null,
    autonomous = (this.database?.getModelConfig(adapter.name)?.agentMode === "autonomous")
  ): Promise<void> {
    if (!this.authedClient) {
      throw new Error("Authenticated client is not initialized");
    }

    const loopGuardEnabled = this.isLoopGuardEnabledForRoom(roomId);

    const session = new RoomAgentSession({
      client: this.authedClient,
      adapter,
      roomId,
      role,
      taskHint,
      autonomous,
      loopGuardEnabled,
      maxNoActionStreak: this.config.agentLoopGuardNoActionStreak,
      initialState: existingSession,
      shouldStop: () => this.stopRequested || this.status === "draining" || !this.coreConnected || this.roomStopRequests.has(roomId),
      onStateChange: async (state) => {
        if (state.status === "idle") {
          if (state.lastCycleOutcome === "acted") {
            this.loopMetrics.actedCycles += 1;
          } else if (state.lastCycleOutcome === "no_action") {
            this.loopMetrics.noActionCycles += 1;
            if (state.lastNoActionReason === "unchanged_room_fingerprint") {
              this.loopMetrics.reentryWithoutProgress += 1;
            }
          }
        }
        this.logger.info(`[database] updating session state for ${state.agentName} to ${state.status} in room ${state.roomId}`);
        this.database?.upsertRoomSession(state);
      },
      onTurn: async ({ context, response, triggeredBy, reason }) => {
        const usage = await this.buildUsageRecord(adapter, context, response.text, role);
        this.meter.track(usage);
        this.recordActivity(
          triggeredBy
            ? "info"
            : "success",
          triggeredBy
            ? `${adapter.name} answered a new room event in ${context.roomName} (${reason})`
            : `${adapter.name} joined ${context.roomName} as ${role}`
        );

        if (this.meter.getSnapshot().pendingUsageRecords >= this.config.maxUsageBatch) {
          await this.flushUsage("threshold");
        }
      },
      logger: this.logger
    });

    await session.run();
  }

  private pickAdapterForInvitation(role: string, taskHint: string): AgentAdapter {
    const normalizedRole = role.toLowerCase();
    const normalizedTask = taskHint.toLowerCase();
    const adapters = this.getInvitationEligibleAdapters();
    if (adapters.length === 0) {
      throw new Error("No recruitable adapters configured");
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

  private getInvitationEligibleAdapters(): AgentAdapter[] {
    const adapters = [...this.adapters.values()];
    if (!this.database?.isReady()) {
      return adapters;
    }

    const eligibleNames = new Set(
      this.database
        .getModelConfigs()
        .filter((model) => model.enabled && model.agentMode !== "manual")
        .map((model) => model.name)
    );

    return adapters.filter((adapter) => eligibleNames.has(adapter.name));
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
    this.logger.warn(
      `[node] operating in local mode - web UI is available at ${process.env.HEXNEST_WEB_URL || `http://127.0.0.1:${process.env.HEXNEST_WEB_PORT || 3000}`}`
    );
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
      id: this.makeUuid(),
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
      availableAgents: this.buildAdvertisedAgents(),
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

  reloadAdapters(adapters: AgentAdapter[]): { adaptersCount: number } {
    this.adapters.clear();
    for (const adapter of adapters) {
      this.adapters.set(adapter.name, adapter);
    }
    this.recordActivity(
      "info",
      `Reloaded agent runtime with ${adapters.length} configured adapter${adapters.length === 1 ? "" : "s"}`
    );
    return { adaptersCount: this.adapters.size };
  }

  getAvailableAgents(): AgentDescriptor[] {
    return this.buildAvailableAgents();
  }

  getNodeStatus() {
    const meter = this.meter.getSnapshot();
    const totalCycles = this.loopMetrics.actedCycles + this.loopMetrics.noActionCycles;
    const actedRate = totalCycles > 0 ? this.loopMetrics.actedCycles / totalCycles : 0;
    const noActionRate = totalCycles > 0 ? this.loopMetrics.noActionCycles / totalCycles : 0;
    const loopGuardEnabled = this.config.agentLoopGuardEnabled !== false;
    const loopGuardRolloutPercent = Math.max(0, Math.min(100, Number(this.config.agentLoopGuardRolloutPercent ?? 100)));
    const loopGuardNoActionStreak = Math.max(1, Number(this.config.agentLoopGuardNoActionStreak ?? 3));
    const alertsMinCycles = Math.max(1, Number(this.config.agentAlertsMinCycles ?? 10));
    const alertsMaxNoActionRate = Math.max(0, Math.min(1, Number(this.config.agentAlertsMaxNoActionRate ?? 0.75)));
    const alertsMaxReentryRate = Math.max(0, Math.min(1, Number(this.config.agentAlertsMaxReentryRate ?? 0.35)));

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
      pendingUsageRecords: meter.pendingUsageRecords,
      actedCycles: this.loopMetrics.actedCycles,
      noActionCycles: this.loopMetrics.noActionCycles,
      reentryWithoutProgress: this.loopMetrics.reentryWithoutProgress,
      actedRate,
      noActionRate,
      loopGuardEnabled,
      loopGuardRolloutPercent,
      loopGuardNoActionStreak,
      alertsMinCycles,
      alertsMaxNoActionRate,
      alertsMaxReentryRate
    };
  }

  private isLoopGuardEnabledForRoom(roomId: string): boolean {
    const loopGuardEnabled = this.config.agentLoopGuardEnabled !== false;
    if (!loopGuardEnabled) {
      return false;
    }

    const rolloutPercent = Math.max(0, Math.min(100, Number(this.config.agentLoopGuardRolloutPercent ?? 100)));
    if (rolloutPercent >= 100) {
      return true;
    }
    if (rolloutPercent <= 0) {
      return false;
    }

    let hash = 0;
    for (let index = 0; index < roomId.length; index += 1) {
      hash = ((hash * 31) + roomId.charCodeAt(index)) % 100;
    }
    return hash < rolloutPercent;
  }

  private buildAvailableAgents(): AgentDescriptor[] {
    return [...this.adapters.values()].map((adapter) => ({
      name: adapter.name,
      capabilities: adapter.capabilities,
      supportedRoles: adapter.supportedRoles
    }));
  }

  private buildAdvertisedAgents(): AgentDescriptor[] {
    if (!this.database?.isReady()) {
      return this.buildAvailableAgents();
    }

    const recruitableNames = new Set(
      this.database
        .getModelConfigs()
        .filter((model) => model.enabled && model.agentMode !== "manual")
        .map((model) => model.name)
    );

    return this.buildAvailableAgents().filter((agent) => recruitableNames.has(agent.name));
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
