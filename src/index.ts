import { loadRuntimeSetupAsync } from "./config.js";
import { NodeRuntime } from "./core/NodeRuntime.js";
import { createWebServer, startWebServer } from "./web/server.js";

async function main(): Promise<void> {
  const { config, adapters, database } = await loadRuntimeSetupAsync();
  const runtime = new NodeRuntime(config, adapters, { database });

  // Create web server with runtime context
  const webApp = createWebServer({
    db: database,
    nodeConfig: config,
    reconnectToCore: (auth?: { userToken?: string; userEmail?: string }) =>
      runtime.reconnectToCore(auth),
    disconnectFromCore: () => runtime.disconnectFromCoreByOperator(),
    resetNodeIdentity: () => runtime.resetNodeIdentityByOperator(),
    removeNodeFromCore: () => runtime.removeCurrentNodeFromCore(),
    getRecentActivity: () => runtime.getRecentActivity(),
    getNodeStatus: () => runtime.getNodeStatus()
  });

  // Start web server FIRST (don't wait for runtime)
  const webPort = parseInt(process.env.HEXNEST_WEB_PORT || "3000", 10);
  await startWebServer(webApp, webPort);

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
