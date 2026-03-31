import { buildAdapters, loadConfig } from "./config.js";
import { NodeRuntime } from "./core/NodeRuntime.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const adapters = buildAdapters();
  const runtime = new NodeRuntime(config, adapters);
  await runtime.start();

  console.log(`[hexnest-node] started with ${adapters.length} adapter(s)`);

  const shutdown = async (signal: string) => {
    console.log(`[hexnest-node] received ${signal}, shutting down`);
    try {
      await runtime.stop();
    } finally {
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
