import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { HexNestClient } from "../src/protocol/HexNestClient.js";

describe("HexNestClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, pendingInvitations: [] }),
      text: async () => ""
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends auth header for heartbeat", async () => {
    const client = new HexNestClient("https://hex-nest.com/", "token-123");
    await client.heartbeat("node-1", {
      status: "online",
      availableAgents: [],
      activeRooms: [],
      meter: { totalTokensUsed: 0, totalRoomsJoined: 0, uptimeSec: 1, pendingUsageRecords: 0 }
    });

    expect(global.fetch).toHaveBeenCalledOnce();
    const [, options] = (global.fetch as any).mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer token-123");
  });

  it("normalizes trailing slash in base URL", async () => {
    const client = new HexNestClient("https://hex-nest.com/");
    await client.registerNode({
      name: "node",
      operatorName: "op",
      agentCapabilities: []
    });

    const [url] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("https://hex-nest.com/api/nodes/register");
  });
});
