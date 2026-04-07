import { loadConfig } from "../config.js";
import type { WebServerContext } from "./server.js";

export function resolveCoreUrl(context: WebServerContext): string {
  try {
    const latest = String(loadConfig(context.db).coreUrl || "").trim();
    if (latest) {
      context.nodeConfig.coreUrl = latest;
    }
  } catch {
    // Keep the last in-memory value if config reload fails.
  }

  const coreUrl = String(context.nodeConfig.coreUrl || "").trim();
  if (!coreUrl) {
    throw new Error("Core connection is not configured in node settings");
  }
  return coreUrl;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0";
}

async function isReachableCore(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, {
      method: "GET",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveReachableCoreUrl(context: WebServerContext): Promise<string> {
  const configured = resolveCoreUrl(context);

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    return configured;
  }

  if (!isLocalHostname(parsed.hostname)) {
    return configured;
  }

  if (await isReachableCore(configured)) {
    return configured;
  }

  const candidatePorts = [parsed.port || "", "10000", "11000"];
  const deduped = [...new Set(candidatePorts.filter(Boolean))]
    .map((port) => `${parsed.protocol}//${parsed.hostname}:${port}`)
    .filter((url) => url !== configured);

  for (const candidate of deduped) {
    if (await isReachableCore(candidate)) {
      context.nodeConfig.coreUrl = candidate;
      context.db.setNodeConfig("core_url", candidate);
      return candidate;
    }
  }

  return configured;
}