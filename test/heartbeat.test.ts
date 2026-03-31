import { describe, expect, it, vi } from "vitest";
import { Heartbeat } from "../src/core/Heartbeat.js";
import { HeartbeatPayload, HeartbeatResponse } from "../src/protocol/types.js";

describe("Heartbeat", () => {
  it("calls client heartbeat with payload from factory", async () => {
    const heartbeatResponse: HeartbeatResponse = { ok: true, pendingInvitations: [] };
    const client = {
      heartbeat: vi.fn().mockResolvedValue(heartbeatResponse)
    };
    const payload: HeartbeatPayload = {
      status: "online",
      availableAgents: [],
      activeRooms: [],
      meter: {
        totalTokensUsed: 0,
        totalRoomsJoined: 0,
        uptimeSec: 10,
        pendingUsageRecords: 0
      }
    };
    const onResponse = vi.fn();
    const heartbeat = new Heartbeat(
      client as any,
      "node-1",
      1000,
      () => payload,
      onResponse
    );

    const result = await heartbeat.pulse();

    expect(result.ok).toBe(true);
    expect(client.heartbeat).toHaveBeenCalledOnce();
    expect(client.heartbeat).toHaveBeenCalledWith("node-1", payload);
    expect(onResponse).toHaveBeenCalledWith(heartbeatResponse);
  });
});
