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

  it("forwards preferred Step 1 room message payloads unchanged", async () => {
    const client = new HexNestClient("https://hex-nest.com/", { nodeToken: "node-token-123" });

    await client.postRoomMessage({
      roomId: "room-1",
      joinedAgentId: "agent-1",
      text: {
        full_text: "Canonical structured response",
        summary: "Short structured summary",
        intent: "claim",
        claims: [{ text: "claim-1" }]
      },
      parseMode: "preferred_json",
      confidence: 0.82
    });

    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("https://hex-nest.com/api/rooms/room-1/messages");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toMatchObject({
      agentId: "agent-1",
      joinedAgentId: "agent-1",
      text: {
        full_text: "Canonical structured response",
        summary: "Short structured summary",
        intent: "claim",
        claims: [{ text: "claim-1" }]
      },
      parseMode: "preferred_json",
      confidence: 0.82
    });
  });

  it("forwards raw fallback parse mode with marker-free canonical text", async () => {
    const client = new HexNestClient("https://hex-nest.com/", { nodeToken: "node-token-123" });

    await client.postRoomMessage({
      roomId: "room-1",
      joinedAgentId: "agent-1",
      text: "fallback room text",
      parseMode: "raw_fallback",
      confidence: 0.61
    });

    expect(global.fetch).toHaveBeenCalledOnce();
    const [, options] = (global.fetch as any).mock.calls[0];
    expect(JSON.parse(options.body)).toMatchObject({
      agentId: "agent-1",
      joinedAgentId: "agent-1",
      text: "fallback room text",
      parseMode: "raw_fallback",
      confidence: 0.61
    });
  });

  it("hydrates summary and claims from core message payloads into room context", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({
          id: "room-1",
          name: "Room 1",
          task: "Task",
          phase: "open_room",
          settings: {},
          artifacts: []
        }),
        headers: { get: () => "application/json" }
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({
          roomId: "room-1",
          count: 1,
          messages: [
            {
              id: "m-1",
              timestamp: "2026-04-24T00:00:00.000Z",
              from: "agent-a",
              to: "room",
              scope: "room",
              text: "Canonical text",
              summary: "Short summary",
              claims: [{ text: "claim-1" }],
              intent: "claim"
            }
          ]
        }),
        headers: { get: () => "application/json" }
      }) as any;

    const client = new HexNestClient("https://hex-nest.com/", { nodeToken: "node-token-123" });
    const context = await client.getRoomContext("room-1", "researcher");

    expect(context.timeline).toHaveLength(1);
    expect(context.timeline[0].summary).toBe("Short summary");
    expect(context.timeline[0].claims).toEqual([{ text: "claim-1" }]);
    expect(context.timeline[0].intent).toBe("claim");
    expect(context.contextSummary).toBe("Recent summaries: Short summary");
  });

  it("builds contextSummary from recent compact summaries when available", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({
          id: "room-1",
          name: "Room 1",
          task: "Task",
          phase: "open_room",
          settings: {},
          artifacts: [{ id: "a1", type: "note", label: "n", content: "c", producer: "p", timestamp: "T" }]
        }),
        headers: { get: () => "application/json" }
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({
          roomId: "room-1",
          count: 4,
          messages: [
            { id: "m-1", timestamp: "2026-04-24T00:00:00.000Z", from: "a", to: "room", scope: "room", text: "t1", summary: "s1" },
            { id: "m-2", timestamp: "2026-04-24T00:01:00.000Z", from: "b", to: "room", scope: "room", text: "t2" },
            { id: "m-3", timestamp: "2026-04-24T00:02:00.000Z", from: "c", to: "room", scope: "room", text: "t3", summary: "s3" },
            { id: "m-4", timestamp: "2026-04-24T00:03:00.000Z", from: "d", to: "room", scope: "room", text: "t4", summary: "s4" }
          ]
        }),
        headers: { get: () => "application/json" }
      }) as any;

    const client = new HexNestClient("https://hex-nest.com/", { nodeToken: "node-token-123" });
    const context = await client.getRoomContext("room-1", "researcher");

    expect(context.contextSummary).toBe("Recent summaries: s1 | s3 | s4");
  });

  it("falls back to count-based contextSummary when no compact summaries exist", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({
          id: "room-1",
          name: "Room 1",
          task: "Task",
          phase: "open_room",
          settings: {},
          artifacts: []
        }),
        headers: { get: () => "application/json" }
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({
          roomId: "room-1",
          count: 2,
          messages: [
            { id: "m-1", timestamp: "2026-04-24T00:00:00.000Z", from: "a", to: "room", scope: "room", text: "t1", intent: "ask_room" },
            { id: "m-2", timestamp: "2026-04-24T00:01:00.000Z", from: "b", to: "room", scope: "direct", text: "t2" }
          ]
        }),
        headers: { get: () => "application/json" }
      }) as any;

    const client = new HexNestClient("https://hex-nest.com/", { nodeToken: "node-token-123" });
    const context = await client.getRoomContext("room-1", "researcher");

    expect(context.contextSummary).toBe("timeline=2; actionable=2; artifacts=0");
  });
});
