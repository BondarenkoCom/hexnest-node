import { describe, expect, it } from "vitest";
import { AgentAdapter, AgentResponse } from "../src/adapters/AgentAdapter.js";
import { NodeConfig } from "../src/config.js";
import { NodeRuntime } from "../src/core/NodeRuntime.js";
import { CostEstimate, RoomContext } from "../src/protocol/types.js";

class FakeAdapter implements AgentAdapter {
  name = "fake-agent";
  modelId = "fake-model";
  capabilities = ["research", "analysis"];
  supportedRoles = ["researcher", "skeptic"];

  async respond(_context: RoomContext): Promise<AgentResponse> {
    return {
      text: "Synthetic response",
      confidence: 0.77
    };
  }

  async estimateCost(_context: RoomContext, _responseText?: string): Promise<CostEstimate> {
    return {
      inputTokens: 10,
      outputTokens: 4,
      estimatedCostUsd: 0.02
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("NodeRuntime", () => {
  it("registers node, handles invitation, submits usage, and marks offline", async () => {
    const calls = {
      register: 0,
      heartbeat: 0,
      joinRoom: 0,
      postMessage: 0,
      submitUsage: 0,
      markOffline: 0
    };

    const client = {
      registerNode: async () => {
        calls.register += 1;
        return { nodeId: "node-1", nodeToken: "token-1", status: "approved" as const };
      },
      getNodeStatus: async () => ({
        nodeId: "node-1",
        approvalStatus: "approved" as const,
        status: "online" as const,
        lastHeartbeatAt: null,
        lastHeartbeatStatus: null
      }),
      heartbeat: async () => {
        calls.heartbeat += 1;
        if (calls.heartbeat === 1) {
          return { ok: true, pendingInvitations: [{ roomId: "room-1", role: "researcher" }] };
        }
        return { ok: true, pendingInvitations: [] };
      },
      submitUsage: async (_nodeId: string, records: unknown[]) => {
        calls.submitUsage += 1;
        return { accepted: records.length, totalOwed: 0.1 };
      },
      markOffline: async () => {
        calls.markOffline += 1;
      },
      joinRoom: async () => {
        calls.joinRoom += 1;
        return {
          roomId: "room-1",
          joinedAgent: { id: "joined-1", name: "fake-agent" }
        };
      },
      postRoomMessage: async () => {
        calls.postMessage += 1;
      },
      getRoomContext: async (_roomId: string, role: string) => {
        return {
          roomId: "room-1",
          roomName: "Room 1",
          task: "Research market dynamics",
          role,
          phase: "independent_answers",
          timeline: [],
          artifacts: [],
          rules: "Cite sources."
        };
      }
    };

    const config: NodeConfig = {
      coreUrl: "https://hex-nest.com",
      nodeName: "node-test",
      operatorName: "operator",
      heartbeatIntervalMs: 60_000,
      approvalPollIntervalMs: 1_000,
      usageFlushIntervalMs: 60_000,
      maxUsageBatch: 1,
      shutdownGraceMs: 3_000,
      autoAcceptInvites: true,
      httpTimeoutMs: 5_000
    };

    const runtime = new NodeRuntime(config, [new FakeAdapter()], {
      clientFactory: () => client as any,
      uuidFactory: () => "usage-1"
    });

    await runtime.start();
    await sleep(40);

    expect(calls.register).toBe(1);
    expect(calls.joinRoom).toBe(1);
    expect(calls.postMessage).toBe(1);
    expect(calls.submitUsage).toBeGreaterThanOrEqual(1);
    expect(runtime.getState().status === "online" || runtime.getState().status === "busy").toBe(true);

    await runtime.stop();
    expect(calls.markOffline).toBe(1);
    expect(runtime.getState().status).toBe("offline");
  });
});
