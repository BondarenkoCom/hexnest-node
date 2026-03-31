import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

async function run(): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    const coreUrl = (await rl.question("HexNest core URL (e.g. https://hex-nest.com): ")).trim();
    const nodeName = (await rl.question("Node name: ")).trim();
    const operatorName = (await rl.question("Operator name: ")).trim();
    const operatorEmail = (await rl.question("Operator email (optional): ")).trim();
    const callbackUrl = (await rl.question("Callback URL (optional): ")).trim();
    const ollamaModel = (await rl.question("Ollama model [qwen2.5:14b]: ")).trim() || "qwen2.5:14b";
    const autoAccept = (await rl.question("Auto-accept invitations? [yes/no, default yes]: ")).trim().toLowerCase();
    const autoAcceptInvites = autoAccept === "" || autoAccept === "yes" || autoAccept === "y";

    if (!coreUrl || !nodeName || !operatorName) {
      throw new Error("core URL, node name, and operator name are required");
    }

    const envContent = [
      `HEXNEST_CORE_URL=${coreUrl}`,
      `HEXNEST_NODE_NAME=${nodeName}`,
      `HEXNEST_OPERATOR_NAME=${operatorName}`,
      `HEXNEST_OPERATOR_EMAIL=${operatorEmail}`,
      `HEXNEST_CALLBACK_URL=${callbackUrl}`,
      "HEXNEST_NODE_TOKEN=",
      "HEXNEST_NODE_ID=",
      "HEXNEST_HEARTBEAT_INTERVAL_MS=60000",
      "HEXNEST_USAGE_FLUSH_INTERVAL_MS=90000",
      "HEXNEST_USAGE_MAX_BATCH=100",
      "HEXNEST_SHUTDOWN_GRACE_MS=30000",
      "HEXNEST_HTTP_TIMEOUT_MS=20000",
      `HEXNEST_AUTO_ACCEPT_INVITES=${autoAcceptInvites ? "true" : "false"}`,
      "",
      "OLLAMA_BASE_URL=http://localhost:11434",
      `OLLAMA_MODEL=${ollamaModel}`,
      "",
      "OPENAI_API_KEY=",
      "OPENAI_MODEL=gpt-5-mini",
      "",
      "ANTHROPIC_API_KEY=",
      "ANTHROPIC_MODEL=claude-3-7-sonnet-latest",
      ""
    ].join("\n");

    const target = path.resolve(process.cwd(), ".env");
    await writeFile(target, envContent, "utf8");
    console.log(`\nWrote config: ${target}`);
    console.log("Next step: npm run dev");
  } finally {
    rl.close();
  }
}

run().catch((error) => {
  console.error("[setup] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
