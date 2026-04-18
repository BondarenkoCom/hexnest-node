import fs from "node:fs/promises";
import path from "node:path";
import type { Request } from "express";
import { resolveRuntimePath } from "../runtime-paths.js";

type DiscoveryKind = "agent-card" | "agent-compat";

interface DiscoveryLogEntry {
  kind: DiscoveryKind;
  timestamp: string;
  path: string;
  ip: string;
  userAgent: string | null;
  referer: string | null;
}

async function appendDiscoveryEntry(entry: DiscoveryLogEntry): Promise<void> {
  const logPath = resolveRuntimePath("data/a2a-discovery.log");
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export function logDiscoveryFetch(req: Request, kind: DiscoveryKind): void {
  const entry: DiscoveryLogEntry = {
    kind,
    timestamp: new Date().toISOString(),
    path: req.originalUrl || req.path,
    ip: req.ip || req.socket.remoteAddress || "unknown",
    userAgent: req.get("user-agent") || null,
    referer: req.get("referer") || null
  };

  console.log("[a2a-discovery]", JSON.stringify(entry));
  void appendDiscoveryEntry(entry).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[a2a-discovery] failed to write telemetry: ${message}`);
  });
}
