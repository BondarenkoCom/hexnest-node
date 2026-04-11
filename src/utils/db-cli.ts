import { DatabaseService } from "../db/database.js";
import { randomUUID } from "node:crypto";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help") {
    console.log(`
HexNest Database Utility

Usage: npx tsx src/utils/db-cli.ts <command> [options]

Commands:
  list                    List all model configurations
  add <type> <name> <model>
                          Add a new model configuration
                          Types: ollama, openai, claude
  delete <name>          Delete a model configuration
  disable <name>         Disable a model configuration
  enable <name>          Enable a model configuration
  help                    Show this help message

Examples:
  npx tsx src/utils/db-cli.ts list
  npx tsx src/utils/db-cli.ts add ollama local-llama qwen2.5:14b
  npx tsx src/utils/db-cli.ts add openai gpt4 gpt-4o-mini
  npx tsx src/utils/db-cli.ts delete local-llama
    `);
    return;
  }

  const db = new DatabaseService();
  await db.ensureReady();
  
  try {
    switch (command) {
      case "list": {
        const configs = db.getModelConfigs();
        if (configs.length === 0) {
          console.log("No model configurations found");
        } else {
          console.log("\nModel Configurations:");
          console.log("=".repeat(80));
          configs.forEach((config) => {
            console.log(`\nName: ${config.name}`);
            console.log(`Type: ${config.type}`);
            console.log(`Model: ${config.model}`);
            if (config.baseUrl) console.log(`Base URL: ${config.baseUrl}`);
            if (config.roles && config.roles.length > 0) console.log(`Roles: ${config.roles.join(", ")}`);
            if (config.capabilities && config.capabilities.length > 0) console.log(`Capabilities: ${config.capabilities.join(", ")}`);
            console.log(`Enabled: ${config.enabled ? "Yes" : "No"}`);
          });
          console.log("\n" + "=".repeat(80));
        }
        break;
      }

      case "add": {
        const type = args[1];
        const name = args[2];
        const model = args[3];

        if (!type || !name || !model) {
          console.error("Usage: add <type> <name> <model>");
          process.exit(1);
        }

        const validTypes = ["ollama", "openai", "claude", "anthropic"];
        if (!validTypes.includes(type.toLowerCase())) {
          console.error(`Invalid type. Supported types: ${validTypes.join(", ")}`);
          process.exit(1);
        }

        const existing = db.getModelConfig(name);
        if (existing) {
          console.error(`Model with name "${name}" already exists`);
          process.exit(1);
        }

        const config = db.addModelConfig({
          id: randomUUID(),
          type: type.toLowerCase(),
          name,
          model,
          enabled: true,
          agentMode: "recruitable",
          active: true
        });

        console.log(`✓ Added model configuration: ${config.name}`);
        break;
      }

      case "delete": {
        const name = args[1];
        if (!name) {
          console.error("Usage: delete <name>");
          process.exit(1);
        }

        const existing = db.getModelConfig(name);
        if (!existing) {
          console.error(`Model with name "${name}" not found`);
          process.exit(1);
        }

        db.deleteModelConfig(name);
        console.log(`✓ Deleted model configuration: ${name}`);
        break;
      }

      case "disable": {
        const name = args[1];
        if (!name) {
          console.error("Usage: disable <name>");
          process.exit(1);
        }

        const config = db.getModelConfig(name);
        if (!config) {
          console.error(`Model with name "${name}" not found`);
          process.exit(1);
        }

        db.updateModelConfig(name, { enabled: false });
        console.log(`✓ Disabled model configuration: ${name}`);
        break;
      }

      case "enable": {
        const name = args[1];
        if (!name) {
          console.error("Usage: enable <name>");
          process.exit(1);
        }

        const config = db.getModelConfig(name);
        if (!config) {
          console.error(`Model with name "${name}" not found`);
          process.exit(1);
        }

        db.updateModelConfig(name, { enabled: true });
        console.log(`✓ Enabled model configuration: ${name}`);
        break;
      }

      default: {
        console.error(`Unknown command: ${command}`);
        console.log("Run with 'help' for usage information");
        process.exit(1);
      }
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
