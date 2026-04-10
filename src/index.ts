import fs from "node:fs/promises";
import path from "node:path";
import { buildAdapters, loadEnvMap, loadRuntimeSetupAsync } from "./config.js";
import { NodeRuntime } from "./core/NodeRuntime.js";
import { resolveRuntimePath } from "./runtime-paths.js";
import { createWebServer, startWebServer } from "./web/server.js";

function parseWebPort(rawPort: string | undefined): { port: number; explicit: boolean } {
  if (rawPort == null || rawPort.trim() === "") {
    return { port: 3000, explicit: false };
  }
  const parsed = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { port: 3000, explicit: false };
  }
  return { port: parsed, explicit: true };
}

function parseBooleanFlag(rawValue: string | undefined): boolean {
  const normalized = String(rawValue || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y";
}

async function persistRuntimeInfo(
  env: Record<string, string>,
  webServer: { host: string; port: number; url: string }
): Promise<string> {
  const runtimeInfoPath = resolveRuntimePath(env.HEXNEST_RUNTIME_INFO_PATH || ".hexnest-runtime.json", env);
  const payload = {
    pid: process.pid,
    host: webServer.host,
    port: webServer.port,
    url: webServer.url,
    startedAt: new Date().toISOString()
  };
  await fs.mkdir(path.dirname(runtimeInfoPath), { recursive: true });
  await fs.writeFile(runtimeInfoPath, JSON.stringify(payload, null, 2), "utf8");
  return runtimeInfoPath;
}

async function clearRuntimeInfo(runtimeInfoPath: string | null): Promise<void> {
  if (!runtimeInfoPath) {
    return;
  }
  try {
    await fs.rm(runtimeInfoPath, { force: true });
  } catch {
    // Ignore runtime info cleanup failures during shutdown.
  }
}

async function main(): Promise<void> {
  console.log("-----------------------------------------");
  console.log("[HexNest Node] VERSION 1.1.0 (Fix Applied)");
  console.log("-----------------------------------------");
  
  const env = loadEnvMap();
  const { config, adapters, database } = await loadRuntimeSetupAsync(env);
  const runtime = new NodeRuntime(config, adapters, { database });
  let runtimeInfoPath: string | null = null;

  // Create web server with runtime context
  const webApp = createWebServer({
    db: database,
    nodeConfig: config,
    reconnectToCore: (auth?: { userToken?: string; userEmail?: string }) =>
      runtime.reconnectToCore(auth),
    disconnectFromCore: () => runtime.disconnectFromCoreByOperator(),
    resetNodeIdentity: () => runtime.resetNodeIdentityByOperator(),
    removeNodeFromCore: () => runtime.removeCurrentNodeFromCore(),
    refreshRuntimeAdapters: () => runtime.reloadAdapters(buildAdapters(database, process.env)),
    startManualRoomSession: (roomId, agentName, role, joinedAgentId, taskHint) =>
      runtime.startManualRoomSession(roomId, agentName, role, joinedAgentId, taskHint),
    stopManualRoomSession: (roomId, agentName) => runtime.stopManualRoomSession(roomId, agentName),
    restartManualRoomSession: (roomId, agentName, taskHint) =>
      runtime.restartManualRoomSession(roomId, agentName, taskHint),
    getRecentActivity: () => runtime.getRecentActivity(),
    getAvailableAgents: () => runtime.getAvailableAgents(),
    getNodeStatus: () => runtime.getNodeStatus()
  });

  // Start web server FIRST (don't wait for runtime)
  const requestedWebPort = parseWebPort(env.HEXNEST_WEB_PORT);
  const webServer = await startWebServer(webApp, requestedWebPort.port, {
    host: env.HEXNEST_WEB_HOST,
    allowPortFallback: !parseBooleanFlag(env.HEXNEST_WEB_PORT_STRICT)
  });
  process.env.HEXNEST_WEB_PORT = String(webServer.port);
  process.env.HEXNEST_WEB_URL = webServer.url;
  runtimeInfoPath = await persistRuntimeInfo(env, webServer);

  // Start runtime in background (allow local operation without core connection)
  void (async () => {
    try {
      await runtime.start();
      console.log(`[hexnest-node] started node=${config.nodeName} adapters=${adapters.length}`);
    } catch (error) {
      console.warn(
        `[hexnest-node] failed to connect to core: ${error instanceof Error ? error.message : String(error)}`
      );
      console.warn("[hexnest-node] operating in local mode - web UI is available");
    }
  })();

  const shutdown = async (signal: string) => {
    console.log(`[hexnest-node] received ${signal}, shutting down`);
    try {
      await runtime.stop();
    } finally {
      await clearRuntimeInfo(runtimeInfoPath);
      database.close();
      process.exit(0);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error) => {
  console.error("[hexnest-node] fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
