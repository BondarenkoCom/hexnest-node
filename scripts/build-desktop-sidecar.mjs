import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const tempDir = path.join(projectRoot, ".desktop-build");
const outputDir = path.join(projectRoot, "src-tauri", "resources", "sidecar");

function platformSuffix() {
  const ext = process.platform === "win32" ? ".exe" : "";
  return `${process.platform}-${process.arch}${ext}`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? -1}`));
    });

    child.on("error", reject);
  });
}

async function main() {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const rawOutput = path.join(tempDir, "hexnest-node-runtime");
  await run("npx", ["pkg", "dist/src/index.js", "--targets", "host", "--output", rawOutput]);

  const sidecarPath = `${rawOutput}${process.platform === "win32" ? ".exe" : ""}`;
  const finalName = `hexnest-node-runtime-${platformSuffix()}`;
  const finalPath = path.join(outputDir, finalName);

  await fs.rm(finalPath, { force: true });
  await fs.copyFile(sidecarPath, finalPath);

  console.log(`[desktop-sidecar] ready: ${path.relative(projectRoot, finalPath)}`);
}

main().catch((error) => {
  console.error("[desktop-sidecar] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});