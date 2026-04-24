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

class StructuredSessionTestAdapter extends SessionTestAdapter {
  override async respond(_context: RoomContext): Promise<AgentResponse> {
    return {
      text: "Canonical structured response",
      confidence: 0.82,
      step1Envelope: {
        parseMode: "preferred_json",
        fullText: "Canonical structured response",
        summary: "Short structured summary",
        intent: "claim",
        claims: [{ text: "claim-1" }]
      }
    };
  }
}

class MinimalSessionTestAdapter extends SessionTestAdapter {
  override async respond(_context: RoomContext): Promise<AgentResponse> {
    return {
      text: "Canonical minimal response",
      confidence: 0.77,
      step1Envelope: {
        parseMode: "minimal_json",
        fullText: "Canonical minimal response",
        summary: "Minimal summary",
        intent: "unknown",
        claims: []
      }
    };
  }
}

class RawFallbackSessionTestAdapter extends SessionTestAdapter {
  override async respond(_context: RoomContext): Promise<AgentResponse> {
    return {
      text: "RAW_FALLBACK: raw fallback response",
      confidence: 0.61
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

  it("posts preferred Step 1 payload when adapter provides structured envelope", async () => {
    const adapter = new StructuredSessionTestAdapter();
    let postedBody: any = null;

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
            to: "structured-agent",
            scope: "direct" as const,
            type: "chat",
            text: "Please answer"
          }
        ]
      }),
      joinRoom: async () => ({ ok: true, role: "researcher", agent: { id: "joined-1", name: "structured-agent" } }),
      postRoomMessage: async (input: any) => {
        postedBody = input;
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
      autonomous: false
    });

    await session.run();

    expect(postedBody.text).toEqual({
      full_text: "Canonical structured response",
      summary: "Short structured summary",
      intent: "claim",
      claims: [{ text: "claim-1" }]
    });
    expect(postedBody.parseMode).toBe("preferred_json");
  });

  it("posts minimal Step 1 payload when adapter provides minimal structured envelope", async () => {
    const adapter = new MinimalSessionTestAdapter();
    let postedBody: any = null;

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
            to: "minimal-agent",
            scope: "direct" as const,
            type: "chat",
            text: "Please answer"
          }
        ]
      }),
      joinRoom: async () => ({ ok: true, role: "researcher", agent: { id: "joined-1", name: "minimal-agent" } }),
      postRoomMessage: async (input: any) => {
        postedBody = input;
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
      autonomous: false
    });

    await session.run();

    expect(postedBody.text).toEqual({
      full_text: "Canonical minimal response",
      summary: "Minimal summary",
      intent: "unknown",
      claims: []
    });
    expect(postedBody.parseMode).toBe("minimal_json");
  });

  it("posts marker-free canonical text and raw_fallback parse mode when no structured envelope exists", async () => {
    const adapter = new RawFallbackSessionTestAdapter();
    let postedBody: any = null;

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
            to: "raw-agent",
            scope: "direct" as const,
            type: "chat",
            text: "Please answer"
          }
        ]
      }),
      joinRoom: async () => ({ ok: true, role: "researcher", agent: { id: "joined-1", name: "raw-agent" } }),
      postRoomMessage: async (input: any) => {
        postedBody = input;
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
      autonomous: false
    });

    await session.run();

    expect(postedBody.text).toBe("raw fallback response");
    expect(postedBody.parseMode).toBe("raw_fallback");
  });

  it("infers propose intent for plain-text fallback replies when no structured envelope exists", async () => {
    class ProposeSessionTestAdapter extends SessionTestAdapter {
      override async respond(): Promise<AgentResponse> {
        return {
          text: "We should ship the bridge first and measure the read path before replacing it.",
          confidence: 0.73
        };
      }
    }

    const adapter = new ProposeSessionTestAdapter();
    let postedBody: any = null;

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
            to: "plain-agent",
            scope: "direct" as const,
            type: "chat",
            text: "Please answer"
          }
        ]
      }),
      joinRoom: async () => ({ ok: true, role: "researcher", agent: { id: "joined-1", name: "plain-agent" } }),
      postRoomMessage: async (input: any) => {
        postedBody = input;
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
      autonomous: false
    });

    await session.run();

    expect(postedBody.text).toMatchObject({
      full_text: "We should ship the bridge first and measure the read path before replacing it.",
      intent: "propose"
    });
    expect(postedBody.parseMode).toBe("minimal_json");
  });

  it("preserves envelope-declared raw_fallback without rewriting it to preferred_json", async () => {
    const adapter: AgentAdapter = {
      name: "raw-envelope-agent",
      modelId: "fake-model",
      capabilities: ["analysis"],
      supportedRoles: ["researcher"],
      async respond(_context: RoomContext): Promise<AgentResponse> {
        return {
          text: "RAW_FALLBACK: declared fallback",
          confidence: 0.5,
          step1Envelope: {
            parseMode: "raw_fallback",
            fullText: "RAW_FALLBACK: declared fallback"
          }
        };
      },
      async estimateCost(_context: RoomContext, _responseText?: string): Promise<CostEstimate> {
        return {
          inputTokens: 1,
          outputTokens: 1,
          estimatedCostUsd: 0
        };
      }
    };
    let postedBody: any = null;

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
            to: "raw-envelope-agent",
            scope: "direct" as const,
            type: "chat",
            text: "Please answer"
          }
        ]
      }),
      joinRoom: async () => ({ ok: true, role: "researcher", agent: { id: "joined-1", name: "raw-envelope-agent" } }),
      postRoomMessage: async (input: any) => {
        postedBody = input;
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
      autonomous: false
    });

    await session.run();

    expect(postedBody.text).toBe("declared fallback");
    expect(postedBody.parseMode).toBe("raw_fallback");
  });

  it("upgrades ordinary plain-text responses into minimal Step 1 payloads", async () => {
    const adapter = new SessionTestAdapter();
    let postedBody: any = null;

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
      postRoomMessage: async (input: any) => {
        postedBody = input;
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
      autonomous: false
    });

    await session.run();

    expect(postedBody.text).toEqual({
      full_text: "Action response",
      summary: "Action response",
      intent: "unknown",
      claims: []
    });
    expect(postedBody.parseMode).toBe("minimal_json");
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
