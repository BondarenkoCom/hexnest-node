import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CodexCliResolution {
  configured: string;
  resolved: string;
  source: "configured" | "path" | "local-bin" | "home-bin" | "volta-bin" | "nvm";
  exists: boolean;
}

function expandHome(input: string): string {
  if (!input) return input;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function isPathLike(input: string): boolean {
  if (!input) return false;
  return (
    path.isAbsolute(input)
    || input.startsWith("./")
    || input.startsWith("../")
    || input.startsWith(".\\")
    || input.startsWith("..\\")
    || input.includes("/")
    || input.includes("\\")
  );
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function candidateNamesForCommand(command: string): string[] {
  if (process.platform !== "win32") {
    return [command];
  }
  const hasExt = path.extname(command) !== "";
  if (hasExt) return [command];
  return [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`];
}

function findInPath(command: string, pathEnv: string | undefined): string | null {
  const names = candidateNamesForCommand(command);
  const segments = String(pathEnv || "")
    .split(path.delimiter)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    for (const name of names) {
      const candidate = path.join(segment, name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function parseNodeSemverTag(tag: string): [number, number, number] | null {
  const match = String(tag).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemverDesc(left: string, right: string): number {
  const l = parseNodeSemverTag(left) || [0, 0, 0];
  const r = parseNodeSemverTag(right) || [0, 0, 0];
  if (l[0] !== r[0]) return r[0] - l[0];
  if (l[1] !== r[1]) return r[1] - l[1];
  return r[2] - l[2];
}

function findFromNvm(command: string): string | null {
  const nvmNodeRoot = path.join(os.homedir(), ".nvm", "versions", "node");
  if (!fs.existsSync(nvmNodeRoot)) {
    return null;
  }
  let versions: string[] = [];
  try {
    versions = fs.readdirSync(nvmNodeRoot).filter((entry) => parseNodeSemverTag(entry));
  } catch {
    return null;
  }
  versions.sort(compareSemverDesc);
  for (const version of versions) {
    const candidate = path.join(nvmNodeRoot, version, "bin", command);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveCodexCliPath(
  configuredPath: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): CodexCliResolution {
  const configured = expandHome(String(configuredPath || env.CODEX_CLI_PATH || "codex").trim() || "codex");

  if (isPathLike(configured)) {
    const absoluteConfigured = path.resolve(configured);
    if (isExecutableFile(absoluteConfigured)) {
      return {
        configured,
        resolved: absoluteConfigured,
        source: "configured",
        exists: true
      };
    }
    // If configured path points to an unavailable codex binary, fall back to normal discovery.
    const fallbackCommand = path.basename(absoluteConfigured) || "codex";
    const fromPathFallback = findInPath(fallbackCommand, env.PATH);
    if (fromPathFallback) {
      return { configured, resolved: fromPathFallback, source: "path", exists: true };
    }
    if (fallbackCommand === "codex") {
      const fromNvmFallback = findFromNvm(fallbackCommand);
      if (fromNvmFallback) {
        return { configured, resolved: fromNvmFallback, source: "nvm", exists: true };
      }
    }
    return {
      configured,
      resolved: absoluteConfigured,
      source: "configured",
      exists: false
    };
  }

  const fromPath = findInPath(configured, env.PATH);
  if (fromPath) {
    return { configured, resolved: fromPath, source: "path", exists: true };
  }

  const fromLocalBin = path.join(os.homedir(), ".local", "bin", configured);
  if (isExecutableFile(fromLocalBin)) {
    return { configured, resolved: fromLocalBin, source: "local-bin", exists: true };
  }

  const fromHomeBin = path.join(os.homedir(), "bin", configured);
  if (isExecutableFile(fromHomeBin)) {
    return { configured, resolved: fromHomeBin, source: "home-bin", exists: true };
  }

  const fromVoltaBin = path.join(os.homedir(), ".volta", "bin", configured);
  if (isExecutableFile(fromVoltaBin)) {
    return { configured, resolved: fromVoltaBin, source: "volta-bin", exists: true };
  }

  if (configured === "codex") {
    const fromNvm = findFromNvm(configured);
    if (fromNvm) {
      return { configured, resolved: fromNvm, source: "nvm", exists: true };
    }
  }

  return { configured, resolved: configured, source: "configured", exists: false };
}
