#!/usr/bin/env node

async function main(): Promise<void> {
  const command = String(process.argv[2] || "").trim().toLowerCase();

  if (command === "setup") {
    await import("./setup.js");
    return;
  }

  if (command === "start") {
    await import("../index.js");
    return;
  }

  if (command === "" || command === "help" || command === "--help" || command === "-h") {
    console.log("HexNest Node CLI");
    console.log("");
    console.log("Usage:");
    console.log("  hexnest-node setup   # Account + node registration wizard");
    console.log("  hexnest-node start   # Start node runtime");
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Run `hexnest-node help` for usage.");
  process.exit(1);
}

main().catch((error) => {
  console.error("[hexnest-node] cli error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

