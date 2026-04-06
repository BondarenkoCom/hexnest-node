import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CoreApiError, HexNestClient } from "../src/protocol/HexNestClient.js";

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
    const client = new HexNestClient("https://hex-nest.com/", { nodeToken: "token-123" });
    await client.heartbeat("node-1", {
      nodeId: "node-1",
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
    const client = new HexNestClient("https://hex-nest.com/", { userToken: "user-token-123" });
    await client.registerNode({
      name: "node",
      operatorName: "op",
      agentCapabilities: []
    });

    const [url] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("https://hex-nest.com/api/nodes/register");
  });

  it("sends user auth header for delete node", async () => {
    const client = new HexNestClient("https://hex-nest.com/", { userToken: "user-token-123" });
    await client.deleteNode("node-1");

    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("https://hex-nest.com/api/nodes/node-1");
    expect(options.method).toBe("DELETE");
    expect(options.headers.Authorization).toBe("Bearer user-token-123");
  });

  it("surfaces json upstream errors without dumping raw payloads", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: {
        get: (name: string) => name.toLowerCase() === "content-type" ? "application/json" : null
      },
      text: async () => JSON.stringify({ error: "invalid credentials" })
    }) as any;

    const client = new HexNestClient("https://hex-nest.com");

    await expect(client.loginUser({ email: "a@example.com", password: "badpass" })).rejects.toMatchObject({
      name: "CoreApiError",
      message: "Core API failed 401 Unauthorized: invalid credentials"
    });
  });

  it("sanitizes html error pages from upstream", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      headers: {
        get: (name: string) => name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null
      },
      text: async () => "<!DOCTYPE html><html><body>bad gateway</body></html>"
    }) as any;

    const client = new HexNestClient("https://hex-nest.com");

    await expect(client.loginUser({ email: "a@example.com", password: "badpass" })).rejects.toEqual(
      expect.objectContaining<Partial<CoreApiError>>({
        name: "CoreApiError",
        message: "Core API failed 502 Bad Gateway: upstream returned HTML instead of JSON"
      })
    );
  });
});
