import { describe, expect, it } from "vitest";
import type { AgentAdapter, AgentResponse } from "../src/adapters/index.js";
import { RoomAgentSession } from "../src/core/RoomAgentSession.js";
import type { RoomContext, CostEstimate } from "../src/protocol/types.js";

class SessionTestAdapter implements AgentAdapter {
  name = "fake-agent";
  modelId = "fake-model";
  capabilities = ["analysis"];
  supportedRoles = ["researcher"];

  async respond(_context: RoomContext): Promise<AgentResponse> {
    return {
      text: "Action response",
      confidence: 0.8
    };
  }

  async estimateCost(_context: RoomContext, _responseText?: string): Promise<CostEstimate> {
    return {
      inputTokens: 1,
      outputTokens: 1,
      estimatedCostUsd: 0
    };
  }
}

describe("RoomAgentSession", () => {
  it("records acted outcome when a trigger is actionable", async () => {
    const adapter = new SessionTestAdapter();
    let stop = false;
    let posted = 0;
    let finalOutcome: string | undefined;

    const client = {
      registerUser: async () => ({ userId: "u", token: "t" }),
      loginUser: async () => ({ userId: "u", token: "t" }),
      registerNode: async () => ({ nodeId: "n", nodeToken: "t", status: "approved" as const }),
      deleteNode: async () => ({ ok: true, nodeId: "n", removed: true }),
      getNodeStatus: async () => ({ nodeId: "n", approvalStatus: "approved" as const }),
      heartbeat: async () => ({ ok: true, pendingInvitations: [] }),
      submitUsage: async () => ({ accepted: 0, totalOwed: 0 }),
      markOffline: async () => undefined,
      listRooms: async () => ({ value: [], count: 0 }),
      createRoom: async () => ({ id: "r", name: "R", task: "t", subnest: "", status: "open", createdAt: "", updatedAt: "", connectedAgents: [] }),
      getRoom: async () => ({ id: "r", name: "R", task: "t", subnest: "", status: "open", createdAt: "", updatedAt: "", connectedAgents: [], settings: { pythonShellEnabled: false }, pythonJobs: [], timeline: [], artifacts: [] }),
      getRoomStats: async () => ({ agents: 0, agentNames: [], totalMessages: 0, totalShares: 0, totalViewers: 0, lastActivity: "" }),
      getRoomConnectBrief: async () => ({}),
      heartbeatRoom: async () => ({}),
      forkRoom: async () => ({ id: "r", name: "R", task: "t", subnest: "", status: "open", createdAt: "", updatedAt: "", connectedAgents: [], settings: { pythonShellEnabled: false }, pythonJobs: [], timeline: [], artifacts: [] }),
      downloadRoomSummary: async () => "",
      exportRoom: async () => ({}),
      getRoomMessages: async () => ({
        roomId: "room-1",
        count: 1,
        messages: [
          {
            id: "m-direct",
            timestamp: "2026-04-13T00:00:00.000Z",
            from: "human",
            to: "fake-agent",
            scope: "direct" as const,
            type: "chat",
            text: "Please answer"
          }
        ]
      }),
      joinRoom: async () => ({ ok: true, role: "researcher", agent: { id: "joined-1", name: "fake-agent" } }),
      postRoomMessage: async () => {
        posted += 1;
        stop = true;
      },
      getRoomContext: async () => ({
        roomId: "room-1",
        roomName: "Room 1",
        task: "Task",
        role: "researcher",
        phase: "open_room",
        timeline: [],
        artifacts: [],
        rules: "Keep concise"
      })
    } as any;

    const session = new RoomAgentSession({
      client,
      adapter,
      roomId: "room-1",
      role: "researcher",
      autonomous: true,
      pollIntervalMs: 1,
      shouldStop: () => stop,
      initialState: {
        roomId: "room-1",
        agentName: "fake-agent",
        role: "researcher",
        joinedAgentId: "joined-1",
        lastSeenMessageId: "missing-id",
        autonomous: true,
        status: "idle",
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      onStateChange: async (state) => {
        finalOutcome = state.lastCycleOutcome;
      }
    });

    await session.run();

    expect(posted).toBe(1);
    expect(finalOutcome).toBe("acted");
  });

  it("marks unchanged fingerprint as re-entry without progress after no-action streak", async () => {
    const adapter = new SessionTestAdapter();
    let stop = false;
    const reasons: string[] = [];

    const duplicateSystemMessages = [
      {
        id: "dup",
        timestamp: "2026-04-13T00:00:00.000Z",
        from: "system",
        to: "room",
        scope: "room" as const,
        type: "system",
        text: "noop"
      },
      {
        id: "dup",
        timestamp: "2026-04-13T00:00:01.000Z",
        from: "system",
        to: "room",
        scope: "room" as const,
        type: "system",
        text: "noop"
      }
    ];

    const client = {
      registerUser: async () => ({ userId: "u", token: "t" }),
      loginUser: async () => ({ userId: "u", token: "t" }),
      registerNode: async () => ({ nodeId: "n", nodeToken: "t", status: "approved" as const }),
      deleteNode: async () => ({ ok: true, nodeId: "n", removed: true }),
      getNodeStatus: async () => ({ nodeId: "n", approvalStatus: "approved" as const }),
      heartbeat: async () => ({ ok: true, pendingInvitations: [] }),
      submitUsage: async () => ({ accepted: 0, totalOwed: 0 }),
      markOffline: async () => undefined,
      listRooms: async () => ({ value: [], count: 0 }),
      createRoom: async () => ({ id: "r", name: "R", task: "t", subnest: "", status: "open", createdAt: "", updatedAt: "", connectedAgents: [] }),
      getRoom: async () => ({ id: "r", name: "R", task: "t", subnest: "", status: "open", createdAt: "", updatedAt: "", connectedAgents: [], settings: { pythonShellEnabled: false }, pythonJobs: [], timeline: [], artifacts: [] }),
      getRoomStats: async () => ({ agents: 0, agentNames: [], totalMessages: 0, totalShares: 0, totalViewers: 0, lastActivity: "" }),
      getRoomConnectBrief: async () => ({}),
      heartbeatRoom: async () => ({}),
      forkRoom: async () => ({ id: "r", name: "R", task: "t", subnest: "", status: "open", createdAt: "", updatedAt: "", connectedAgents: [], settings: { pythonShellEnabled: false }, pythonJobs: [], timeline: [], artifacts: [] }),
      downloadRoomSummary: async () => "",
      exportRoom: async () => ({}),
      getRoomMessages: async () => ({
        roomId: "room-1",
        count: duplicateSystemMessages.length,
        messages: duplicateSystemMessages
      }),
      joinRoom: async () => ({ ok: true, role: "researcher", agent: { id: "joined-1", name: "fake-agent" } }),
      postRoomMessage: async () => undefined,
      getRoomContext: async () => ({
        roomId: "room-1",
        roomName: "Room 1",
        task: "Task",
        role: "researcher",
        phase: "open_room",
        timeline: [],
        artifacts: [],
        rules: "Keep concise"
      })
    } as any;

    const session = new RoomAgentSession({
      client,
      adapter,
      roomId: "room-1",
      role: "researcher",
      autonomous: true,
      pollIntervalMs: 1,
      shouldStop: () => stop,
      initialState: {
        roomId: "room-1",
        agentName: "fake-agent",
        role: "researcher",
        joinedAgentId: "joined-1",
        lastSeenMessageId: "missing-id",
        autonomous: true,
        status: "idle",
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      onStateChange: async (state) => {
        if (state.lastCycleOutcome === "no_action" && state.lastNoActionReason) {
          reasons.push(state.lastNoActionReason);
          if (state.lastNoActionReason === "unchanged_room_fingerprint") {
            stop = true;
          }
        }
      }
    });

    await session.run();

    expect(reasons).toContain("policy_rejected_unseen_messages");
    expect(reasons).toContain("unchanged_room_fingerprint");
  });

  it("does not emit unchanged_room_fingerprint when loop guard is disabled", async () => {
    const adapter = new SessionTestAdapter();
    let stop = false;
    const reasons: string[] = [];

    const duplicateSystemMessages = [
      {
        id: "dup",
        timestamp: "2026-04-13T00:00:00.000Z",
        from: "system",
        to: "room",
        scope: "room" as const,
        type: "system",
        text: "noop"
      },
      {
        id: "dup",
        timestamp: "2026-04-13T00:00:01.000Z",
        from: "system",
        to: "room",
        scope: "room" as const,
        type: "system",
        text: "noop"
      }
    ];

    const client = {
      registerUser: async () => ({ userId: "u", token: "t" }),
      loginUser: async () => ({ userId: "u", token: "t" }),
      registerNode: async () => ({ nodeId: "n", nodeToken: "t", status: "approved" as const }),
      deleteNode: async () => ({ ok: true, nodeId: "n", removed: true }),
      getNodeStatus: async () => ({ nodeId: "n", approvalStatus: "approved" as const }),
      heartbeat: async () => ({ ok: true, pendingInvitations: [] }),
      submitUsage: async () => ({ accepted: 0, totalOwed: 0 }),
      markOffline: async () => undefined,
      listRooms: async () => ({ value: [], count: 0 }),
      createRoom: async () => ({ id: "r", name: "R", task: "t", subnest: "", status: "open", createdAt: "", updatedAt: "", connectedAgents: [] }),
      getRoom: async () => ({ id: "r", name: "R", task: "t", subnest: "", status: "open", createdAt: "", updatedAt: "", connectedAgents: [], settings: { pythonShellEnabled: false }, pythonJobs: [], timeline: [], artifacts: [] }),
      getRoomStats: async () => ({ agents: 0, agentNames: [], totalMessages: 0, totalShares: 0, totalViewers: 0, lastActivity: "" }),
      getRoomConnectBrief: async () => ({}),
      heartbeatRoom: async () => ({}),
      forkRoom: async () => ({ id: "r", name: "R", task: "t", subnest: "", status: "open", createdAt: "", updatedAt: "", connectedAgents: [], settings: { pythonShellEnabled: false }, pythonJobs: [], timeline: [], artifacts: [] }),
      downloadRoomSummary: async () => "",
      exportRoom: async () => ({}),
      getRoomMessages: async () => ({
        roomId: "room-1",
        count: duplicateSystemMessages.length,
        messages: duplicateSystemMessages
      }),
      joinRoom: async () => ({ ok: true, role: "researcher", agent: { id: "joined-1", name: "fake-agent" } }),
      postRoomMessage: async () => undefined,
      getRoomContext: async () => ({
        roomId: "room-1",
        roomName: "Room 1",
        task: "Task",
        role: "researcher",
        phase: "open_room",
        timeline: [],
        artifacts: [],
        rules: "Keep concise"
      })
    } as any;

    const session = new RoomAgentSession({
      client,
      adapter,
      roomId: "room-1",
      role: "researcher",
      autonomous: true,
      loopGuardEnabled: false,
      pollIntervalMs: 1,
      shouldStop: () => stop,
      initialState: {
        roomId: "room-1",
        agentName: "fake-agent",
        role: "researcher",
        joinedAgentId: "joined-1",
        lastSeenMessageId: "missing-id",
        autonomous: true,
        status: "idle",
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      onStateChange: async (state) => {
        if (state.lastCycleOutcome === "no_action" && state.lastNoActionReason) {
          reasons.push(state.lastNoActionReason);
          if (reasons.length >= 4) {
            stop = true;
          }
        }
      }
    });

    await session.run();

    expect(reasons).toContain("policy_rejected_unseen_messages");
    expect(reasons).not.toContain("unchanged_room_fingerprint");
  });
});

