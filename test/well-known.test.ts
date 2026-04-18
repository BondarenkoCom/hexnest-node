import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import { createWebServer, type WebServerContext } from "../src/web/server.js";

function createTestContext(): WebServerContext {
  return {
    db: {} as any,
    nodeConfig: {} as any,
    reconnectToCore: async () => ({ coreUrl: "http://core.local", coreConnected: false, nodeId: null }),
    disconnectFromCore: async () => ({ coreUrl: "http://core.local", coreConnected: false, nodeId: null }),
    resetNodeIdentity: async () => ({ previousNodeId: null }),
    removeNodeFromCore: async () => ({ removed: false, nodeId: null }),
    refreshRuntimeAdapters: () => ({ adaptersCount: 2 }),
    startManualRoomSession: async () => ({ started: false, alreadyRunning: false }),
    stopManualRoomSession: async () => ({ stopped: false, hadActiveRun: false }),
    restartManualRoomSession: async () => ({ started: false, alreadyRunning: false }),
    getRecentActivity: () => [],
    getAvailableAgents: () => [
      {
        name: "Aya",
        capabilities: ["reasoning", "critique"],
        supportedRoles: ["expert", "critic"],
        protocol: "hexnest"
      }
    ],
    getNodeStatus: () => ({
      id: "node-123",
      isRunning: true,
      uptime: 12_345,
      adaptersCount: 2,
      coreConnected: true,
      coreConnectionReason: null,
      runtimeStatus: "online" as const,
      heartbeatIntervalMs: 60_000,
      lastHeartbeatAt: "2026-04-18T00:00:00.000Z",
      activeRoomsCount: 1,
      pendingUsageRecords: 0,
      actedCycles: 4,
      noActionCycles: 1,
      reentryWithoutProgress: 0,
      actedRate: 0.8,
      noActionRate: 0.2,
      loopGuardEnabled: true,
      loopGuardRolloutPercent: 100,
      loopGuardNoActionStreak: 3,
      alertsMinCycles: 10,
      alertsMaxNoActionRate: 0.75,
      alertsMaxReentryRate: 0.35
    })
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = createWebServer(createTestContext());
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function waitForLogEntries(logPath: string, minEntries: number): Promise<string[]> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    try {
      const content = await fs.readFile(logPath, "utf8");
      const lines = content.split(/\r?\n/).filter(Boolean);
      if (lines.length >= minEntries) {
        return lines;
      }
    } catch {
      // Telemetry is written asynchronously; keep polling briefly.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`expected at least ${minEntries} discovery log entries in ${logPath}`);
}

describe("well-known discovery", () => {
  const originalAppDataDir = process.env.HEXNEST_APP_DATA_DIR;
  const originalPublicUrl = process.env.HEXNEST_PUBLIC_URL;
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexnest-discovery-"));
    process.env.HEXNEST_APP_DATA_DIR = tempDir;
    delete process.env.HEXNEST_PUBLIC_URL;
  });

  afterEach(async () => {
    if (originalAppDataDir === undefined) {
      delete process.env.HEXNEST_APP_DATA_DIR;
    } else {
      process.env.HEXNEST_APP_DATA_DIR = originalAppDataDir;
    }

    if (originalPublicUrl === undefined) {
      delete process.env.HEXNEST_PUBLIC_URL;
    } else {
      process.env.HEXNEST_PUBLIC_URL = originalPublicUrl;
    }

    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("serves public discovery endpoints before auth and SPA fallback", async () => {
    const { server, baseUrl } = await startTestServer();

    try {
      const cardResponse = await fetch(`${baseUrl}/.well-known/agent-card.json`);
      assert.equal(cardResponse.status, 200);
      assert.match(cardResponse.headers.get("content-type") || "", /application\/json/i);
      assert.equal(cardResponse.headers.get("cache-control"), "public, max-age=60");

      const card = await cardResponse.json();
      assert.equal(card.protocolVersion, "1.0");
      assert.equal(card.name, "HexNest Reference Node");
      assert.equal(card.url, baseUrl);
      assert.equal(card.version, "0.1.0");
      assert.deepEqual(card.metadata.node, {
        status: "online",
        runtimeStatus: "online",
        nodeId: "node-123",
        uptime: 12_345,
        adaptersCount: 2,
        coreConnected: true
      });
      assert.deepEqual(card.metadata.availableAgents, [
        {
          name: "Aya",
          capabilities: ["reasoning", "critique"],
          supportedRoles: ["expert", "critic"],
          protocol: "hexnest"
        }
      ]);

      const compatResponse = await fetch(`${baseUrl}/.well-known/agent.json`);
      assert.equal(compatResponse.status, 200);
      assert.deepEqual(await compatResponse.json(), card);

      const logLines = await waitForLogEntries(path.join(tempDir, "data", "a2a-discovery.log"), 2);
      assert.equal(JSON.parse(logLines[0]).kind, "agent-card");
      assert.equal(JSON.parse(logLines[1]).kind, "agent-compat");
    } finally {
      await closeServer(server);
    }
  });

  it("rate limits discovery requests per IP", async () => {
    const { server, baseUrl } = await startTestServer();

    try {
      for (let index = 0; index < 60; index += 1) {
        const response = await fetch(`${baseUrl}/.well-known/agent-card.json`);
        assert.equal(response.status, 200);
      }

      const limitedResponse = await fetch(`${baseUrl}/.well-known/agent-card.json`);
      assert.equal(limitedResponse.status, 429);
      assert.match(limitedResponse.headers.get("retry-after") || "", /^[1-9]\d*$/);
    } finally {
      await closeServer(server);
    }
  });
});
