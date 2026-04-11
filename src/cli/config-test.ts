#!/usr/bin/env node

/**
 * Quick test to verify HexNest Node can load config and connect
 */

import { loadRuntimeSetupAsync } from "../config.js";

async function test(): Promise<void> {
  console.log("=== HexNest Node Configuration Test ===\n");

  try {
    const { config, adapters, database } = await loadRuntimeSetupAsync();

    console.log("✓ Configuration loaded:");
    console.log(`  - Core URL: ${config.coreUrl}`);
    console.log(`  - Node name: ${config.nodeName}`);
    console.log(`  - Operator: ${config.operatorName}`);
    console.log(`  - User token: ${config.userToken ? "SET ✓" : "NOT SET ⚠"}`);
    console.log(`  - Adapters: ${adapters.length}`);

    if (adapters.length > 0) {
      console.log("\n✓ Available adapters:");
      adapters.forEach((adapter) => {
        console.log(`  - ${adapter.name} (${adapter.capabilities.join(", ")})`);
      });
    }

    console.log("\n✓ Database initialized");

    if (!config.userToken) {
      console.log(
        "\n⚠️  Note: user token is not configured yet. Sign in through the web UI or set it in runtime config."
      );
      console.log("   Steps:");
      console.log("   1. Go to: https://hex-nest.com/signin (or /signup)");
      console.log("   2. Create/login to your account");
      console.log("   3. Connect the node to core from the Settings screen");
      console.log("   4. Run: npm run dev\n");
    } else {
      console.log("\n✓ User token configured - node will auto-register on startup\n");
    }

    database.close();
    console.log("✓ All checks passed!");
  } catch (error) {
    console.error(
      "✗ Error:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

test();
