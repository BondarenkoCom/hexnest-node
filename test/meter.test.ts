import { describe, expect, it } from "vitest";
import { CommissionMeter } from "../src/core/CommissionMeter.js";

describe("CommissionMeter", () => {
  it("tracks totals and submits in batches", async () => {
    const meter = new CommissionMeter();
    meter.track({
      id: "u1",
      roomId: "room-1",
      agentName: "a1",
      inputTokens: 100,
      outputTokens: 30,
      estimatedCostUsd: 0.12,
      recordedAt: "2026-01-01T00:00:00.000Z"
    });
    meter.track({
      id: "u2",
      roomId: "room-1",
      agentName: "a1",
      inputTokens: 80,
      outputTokens: 20,
      estimatedCostUsd: 0.08,
      recordedAt: "2026-01-01T00:01:00.000Z"
    });
    meter.track({
      id: "u3",
      roomId: "room-2",
      agentName: "a2",
      inputTokens: 50,
      outputTokens: 25,
      estimatedCostUsd: 0.05,
      recordedAt: "2026-01-01T00:02:00.000Z"
    });

    const snapshot = meter.getSnapshot();
    expect(snapshot.totalTokensUsed).toBe(305);
    expect(snapshot.totalRoomsJoined).toBe(2);
    expect(snapshot.totalEstimatedCostUsd).toBe(0.25);
    expect(snapshot.pendingUsageRecords).toBe(3);

    const submittedBatches: number[] = [];
    const client = {
      submitUsage: async (_nodeId: string, batch: unknown[]) => {
        submittedBatches.push(batch.length);
        return { accepted: batch.length, totalOwed: 0.33 };
      }
    };

    const result = await meter.submit(client as any, "node-1", 2);
    expect(submittedBatches).toEqual([2, 1]);
    expect(result.accepted).toBe(3);
    expect(result.totalOwed).toBe(0.66);
    expect(meter.getSnapshot().pendingUsageRecords).toBe(0);
  });
});
