import fs from "node:fs";
import { mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { resolveDefaultEnvFile } from "../runtime-paths.js";
import { resolveCodexCliPath } from "../utils/codex-cli.js";

const execFileAsync = promisify(execFile);
const STABLE_CODEX_PATH = path.join(os.homedir(), ".local", "bin", "codex");

function upsertEnvVar(content: string, key: string, value: string): string {
  const lines = content.split("\n");
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    updated.push(`${key}=${value}`);
  }
  return updated.join("\n");
}

async function ensureStableCodexSymlink(targetPath: string): Promise<string> {
  const stableDir = path.dirname(STABLE_CODEX_PATH);
  await mkdir(stableDir, { recursive: true });
  const stableAbsolute = path.resolve(STABLE_CODEX_PATH);
  let normalizedTarget = path.resolve(targetPath);

  if (normalizedTarget === stableAbsolute) {
    try {
      const realTarget = fs.realpathSync(normalizedTarget);
      if (realTarget !== stableAbsolute) {
        normalizedTarget = realTarget;
      }
    } catch {
      // keep normalizedTarget as-is; guarded below.
    }
  }

  if (normalizedTarget === stableAbsolute) {
    throw new Error(
      "Resolved codex target points to the stable symlink itself. " +
      "Unset CODEX_CLI_PATH or point it to a real binary, then rerun `npm run codex:setup`."
    );
  }

  try {
    const stat = fs.lstatSync(STABLE_CODEX_PATH);
    if (stat.isSymbolicLink()) {
      const linked = fs.readlinkSync(STABLE_CODEX_PATH);
      const linkedAbs = path.resolve(path.dirname(STABLE_CODEX_PATH), linked);
      if (linkedAbs === normalizedTarget) {
        return STABLE_CODEX_PATH;
      }
      await unlink(STABLE_CODEX_PATH);
    } else {
      await unlink(STABLE_CODEX_PATH);
    }
  } catch {
    // Path does not exist; create below.
  }

  await symlink(normalizedTarget, STABLE_CODEX_PATH);
  return STABLE_CODEX_PATH;
}

async function checkCodexLogin(commandPath: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(commandPath, ["login", "status"], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    const output = `${stdout || ""}\n${stderr || ""}`.trim();
    if (/logged\s+in/i.test(output)) {
      return { ok: true, message: output };
    }
    return { ok: false, message: output || "Codex CLI is available but not logged in." };
  } catch (error: any) {
    const stderr = String(error?.stderr || "").trim();
    const stdout = String(error?.stdout || "").trim();
    return { ok: false, message: stderr || stdout || "Failed to run `codex login status`." };
  }
}

async function run(): Promise<void> {
  const envFile = resolveDefaultEnvFile(process.env) || path.resolve(process.cwd(), ".env");
  const resolution = resolveCodexCliPath(process.env.CODEX_CLI_PATH || "codex");

  if (!resolution.exists) {
    console.error(
      `[codex-setup] Codex CLI not found. Checked command: ${resolution.configured}\n` +
      "Install Codex CLI and ensure `codex` is available, then rerun `npm run codex:setup`."
    );
    process.exit(1);
  }

  const stablePath = await ensureStableCodexSymlink(path.resolve(resolution.resolved));
  const envValue = "~/.local/bin/codex";

  let envContent = "";
  if (fs.existsSync(envFile)) {
    envContent = await readFile(envFile, "utf8");
  }
  const updated = upsertEnvVar(envContent, "CODEX_CLI_PATH", envValue);
  if (updated !== envContent) {
    await writeFile(envFile, updated.endsWith("\n") ? updated : `${updated}\n`, "utf8");
  }

  const login = await checkCodexLogin(stablePath);

  console.log(`[codex-setup] Resolved codex binary: ${resolution.resolved} (${resolution.source})`);
  console.log(`[codex-setup] Stable codex link:    ${stablePath}`);
  console.log(`[codex-setup] Updated ${envFile}: CODEX_CLI_PATH=${envValue}`);
  if (login.ok) {
    console.log("[codex-setup] Codex login status: OK");
    return;
  }
  console.warn("[codex-setup] Codex login status: NOT READY");
  if (login.message) {
    console.warn(login.message);
  }
  console.warn(`[codex-setup] Run: ${stablePath} login`);
}

run().catch((error) => {
  console.error("[codex-setup] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
