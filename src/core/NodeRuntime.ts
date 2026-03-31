import { randomUUID } from "node:crypto";
import { AgentAdapter } from "../adapters/AgentAdapter.js";
import { NodeConfig } from "../config.js";
import { HexNestClient } from "../protocol/HexNestClient.js";
import {
  AgentDescriptor,
  HeartbeatPayload,
  PendingInvitation,
  RegisterNodeRequest,
  RoomContext,
  UsageRecord
} from "../protocol/types.js";
import { CommissionMeter } from "./CommissionMeter.js";
import { Heartbeat } from "./Heartbeat.js";

export class NodeRuntime {
  private readonly client: HexNestClient;
  private readonly meter = new CommissionMeter();
  private readonly adapters = new Map<string, AgentAdapter>();
  private readonly activeRooms = new Set<string>();
  private readonly startedAt = Date.now();

  private nodeId: string | null;
  private nodeToken: string | null;
  private heartbeat: Heartbeat | null = null;
  private invitationPoll: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly config: NodeConfig,
    adapters: AgentAdapter[]
  ) {
    this.nodeId = config.nodeId || null;
    this.nodeToken = config.nodeToken || null;
    this.client = new HexNestClient(config.coreUrl, this.nodeToken || undefined);
    for (const adapter of adapters) {
      this.adapters.set(adapter.name, adapter);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    if (!this.nodeId || !this.nodeToken) {
      const registration = await this.registerInCore();
      this.nodeId = registration.nodeId;
      this.nodeToken = registration.nodeToken;
      console.log(`[node] registered: ${this.nodeId} (${registration.status})`);
    }

    if (!this.nodeId) {
      throw new Error("Node ID is missing after registration");
    }

    const authedClient = new HexNestClient(this.config.coreUrl, this.nodeToken || undefined);
    this.heartbeat = new Heartbeat(
      authedClient,
      this.nodeId,
      this.config.heartbeatIntervalMs,
      () => this.buildHeartbeatPayload(),
      async (response) => {
        await this.processInvitations(response.pendingInvitations || []);
      }
    );
    await this.heartbeat.pulse();
    this.heartbeat.start();

    this.invitationPoll = setInterval(() => {
      if (!this.heartbeat) return;
      void this.heartbeat.pulse().catch((error) => {
        console.error("[node] poll pulse failed:", error instanceof Error ? error.message : String(error));
      });
    }, this.config.invitationPollMs);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.invitationPoll) {
      clearInterval(this.invitationPoll);
      this.invitationPoll = null;
    }
    this.heartbeat?.stop();
    this.heartbeat = null;

    if (this.nodeId && this.nodeToken) {
      const authedClient = new HexNestClient(this.config.coreUrl, this.nodeToken);
      try {
        await this.meter.submit(authedClient, this.nodeId);
      } catch (error) {
        console.error("[node] usage submit failed on shutdown:", error instanceof Error ? error.message : String(error));
      }
      try {
        await authedClient.markOffline(this.nodeId);
      } catch (error) {
        console.error("[node] mark offline failed:", error instanceof Error ? error.message : String(error));
      }
    }
  }

  async handleRoomInvitation(roomId: string, role: string): Promise<void> {
    if (!this.nodeId || !this.nodeToken) {
      throw new Error("Node is not started");
    }
    if (this.activeRooms.has(roomId)) return;
    this.activeRooms.add(roomId);
    try {
      const adapter = this.pickAdapterForRole(role);
      const authedClient = new HexNestClient(this.config.coreUrl, this.nodeToken);
      const joined = await authedClient.joinRoom(roomId, adapter.name, role);
      const context = await authedClient.getRoomContext(roomId, role);
      const response = await adapter.respond(context);
      await authedClient.postRoomMessage(roomId, joined.joinedAgent.id, response.text, response.confidence);

      const usage = await this.buildUsageRecord(adapter, context, response.text);
      this.meter.track(usage);
    } finally {
      this.activeRooms.delete(roomId);
    }
  }

  private async registerInCore(): Promise<{ nodeId: string; nodeToken: string; status: string }> {
    const capabilities = this.getAvailableAgents().flatMap((agent) => agent.capabilities);
    const payload: RegisterNodeRequest = {
      name: this.config.nodeName,
      operatorName: this.config.operatorName,
      operatorEmail: this.config.operatorEmail,
      agentCapabilities: [...new Set(capabilities)]
    };
    const registration = await this.client.registerNode(payload);
    return {
      nodeId: registration.nodeId,
      nodeToken: registration.nodeToken,
      status: registration.status
    };
  }

  private buildHeartbeatPayload(): HeartbeatPayload {
    const meter = this.meter.getSnapshot();
    return {
      status: this.activeRooms.size > 0 ? "busy" : "online",
      availableAgents: this.getAvailableAgents(),
      activeRooms: [...this.activeRooms],
      meter: {
        totalTokensUsed: meter.totalTokensUsed,
        totalRoomsJoined: meter.totalRoomsJoined,
        uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
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

  private pickAdapterForRole(role: string): AgentAdapter {
    const exact = [...this.adapters.values()].find((adapter) => adapter.supportedRoles.includes(role));
    if (exact) return exact;
    const first = [...this.adapters.values()][0];
    if (!first) throw new Error("No adapters configured");
    return first;
  }

  private async processInvitations(invitations: PendingInvitation[]): Promise<void> {
    if (!this.config.autoAcceptInvites || invitations.length === 0) return;
    for (const invitation of invitations) {
      try {
        await this.handleRoomInvitation(invitation.roomId, invitation.role);
      } catch (error) {
        console.error(
          `[node] invitation failed for room=${invitation.roomId}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  private async buildUsageRecord(adapter: AgentAdapter, context: RoomContext, responseText: string): Promise<UsageRecord> {
    const cost = await adapter.estimateCost(context, responseText);
    return {
      id: randomUUID(),
      roomId: context.roomId,
      agentName: adapter.name,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      estimatedCostUsd: cost.estimatedCostUsd,
      recordedAt: new Date().toISOString()
    };
  }
}
