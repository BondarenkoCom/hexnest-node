import process from "node:process";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

const ROLLOUT_PRESETS = {
  canary10: {
    agentLoopGuardEnabled: true,
    agentLoopGuardRolloutPercent: 10,
    agentLoopGuardNoActionStreak: 3,
    agentAlertsMinCycles: 10,
    agentAlertsMaxNoActionRate: 0.75,
    agentAlertsMaxReentryRate: 0.35
  },
  canary50: {
    agentLoopGuardEnabled: true,
    agentLoopGuardRolloutPercent: 50,
    agentLoopGuardNoActionStreak: 3,
    agentAlertsMinCycles: 10,
    agentAlertsMaxNoActionRate: 0.75,
    agentAlertsMaxReentryRate: 0.35
  },
  full100: {
    agentLoopGuardEnabled: true,
    agentLoopGuardRolloutPercent: 100,
    agentLoopGuardNoActionStreak: 3,
    agentAlertsMinCycles: 10,
    agentAlertsMaxNoActionRate: 0.75,
    agentAlertsMaxReentryRate: 0.35
  },
  rollback: {
    agentLoopGuardEnabled: false,
    agentLoopGuardRolloutPercent: 0,
    agentLoopGuardNoActionStreak: 3,
    agentAlertsMinCycles: 10,
    agentAlertsMaxNoActionRate: 0.75,
    agentAlertsMaxReentryRate: 0.35
  }
};

function printUsage() {
  console.log("Usage: node scripts/loop-ops-smoke.mjs [options]");
  console.log("");
  console.log("Options:");
  console.log("  --base-url <url>           Node manager URL (default: http://127.0.0.1:3000)");
  console.log("  --token <jwt>              Session token used as hexnest_node_session cookie");
  console.log("  --room-id <id>             Optional room ID for /api/status/context-debug");
  console.log("  --role <role>              Optional role for context-debug (default: researcher)");
  console.log("  --rollout <preset>         Apply rollout preset: canary10 | canary50 | full100 | rollback");
  console.log("  --strict-alerts            Exit non-zero when /loop-alerts state is warn/error");
  console.log("  --print-payloads-only      Print rollout payload templates and exit");
  console.log("  --help                     Show this help");
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    token: process.env.HEXNEST_USER_TOKEN || "",
    roomId: "",
    role: "researcher",
    rollout: "",
    strictAlerts: false,
    printPayloadsOnly: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      args.help = true;
      continue;
    }
    if (arg === "--strict-alerts") {
      args.strictAlerts = true;
      continue;
    }
    if (arg === "--print-payloads-only") {
      args.printPayloadsOnly = true;
      continue;
    }

    const next = argv[i + 1];
    if ((arg === "--base-url" || arg === "--token" || arg === "--room-id" || arg === "--role" || arg === "--rollout") && typeof next === "string") {
      if (arg === "--base-url") args.baseUrl = next;
      if (arg === "--token") args.token = next;
      if (arg === "--room-id") args.roomId = next;
      if (arg === "--role") args.role = next;
      if (arg === "--rollout") args.rollout = next;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printPayloadTemplates() {
  console.log("[loop-ops] rollout payload templates:");
  for (const [name, payload] of Object.entries(ROLLOUT_PRESETS)) {
    console.log(`\n# ${name}`);
    console.log(JSON.stringify(payload, null, 2));
  }
}

function normalizeBaseUrl(url) {
  return String(url || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function requestJson(baseUrl, path, options = {}) {
  const timeoutMs = 12_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { success: false, error: `Invalid JSON response for ${path}` };
    }

    return {
      ok: response.ok,
      status: response.status,
      body
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildHeaders(token) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (String(token || "").trim()) {
    headers.Cookie = `hexnest_node_session=${encodeURIComponent(String(token).trim())}`;
  }

  return headers;
}

async function maybeApplyRollout(baseUrl, headers, rolloutName) {
  if (!rolloutName) {
    return;
  }

  const payload = ROLLOUT_PRESETS[rolloutName];
  if (!payload) {
    throw new Error(`Unknown rollout preset: ${rolloutName}`);
  }

  console.log(`[loop-ops] applying rollout preset: ${rolloutName}`);
  const result = await requestJson(baseUrl, "/api/config", {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload)
  });

  if (!result.ok || !result.body?.success) {
    throw new Error(`Failed to apply rollout preset (${rolloutName}): HTTP ${result.status} ${result.body?.error || "unknown error"}`);
  }

  console.log("[loop-ops] rollout preset applied");
}

function ensureSuccess(result, path) {
  if (!result.ok || !result.body?.success) {
    const reason = result.body?.error || "unknown error";
    throw new Error(`${path} failed: HTTP ${result.status} ${reason}`);
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  printPayloadTemplates();
  if (args.printPayloadsOnly) {
    return;
  }

  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const headers = buildHeaders(args.token);

  if (!String(args.token || "").trim()) {
    console.warn("[loop-ops] warning: token is empty; protected endpoints will likely return 401");
  }

  await maybeApplyRollout(baseUrl, headers, args.rollout);

  const statusResult = await requestJson(baseUrl, "/api/status", { method: "GET", headers });
  ensureSuccess(statusResult, "/api/status");

  const alertsResult = await requestJson(baseUrl, "/api/status/loop-alerts", { method: "GET", headers });
  ensureSuccess(alertsResult, "/api/status/loop-alerts");

  console.log("\n[loop-ops] status snapshot:");
  console.log(JSON.stringify({
    loopGuardEnabled: statusResult.body.data.loopGuardEnabled,
    loopGuardRolloutPercent: statusResult.body.data.loopGuardRolloutPercent,
    loopGuardNoActionStreak: statusResult.body.data.loopGuardNoActionStreak,
    actedCycles: statusResult.body.data.actedCycles,
    noActionCycles: statusResult.body.data.noActionCycles,
    reentryWithoutProgress: statusResult.body.data.reentryWithoutProgress,
    actedRate: statusResult.body.data.actedRate,
    noActionRate: statusResult.body.data.noActionRate
  }, null, 2));

  console.log("\n[loop-ops] loop alerts:");
  console.log(JSON.stringify(alertsResult.body.data, null, 2));

  if (args.roomId) {
    const query = new URLSearchParams({ roomId: args.roomId, role: args.role || "researcher" }).toString();
    const contextResult = await requestJson(baseUrl, `/api/status/context-debug?${query}`, {
      method: "GET",
      headers
    });
    ensureSuccess(contextResult, "/api/status/context-debug");

    console.log("\n[loop-ops] context-debug summary:");
    console.log(JSON.stringify({
      roomId: contextResult.body.data.roomId,
      role: contextResult.body.data.role,
      contextVersion: contextResult.body.data.contextVersion,
      timelineCount: contextResult.body.data.timelineCount,
      actionableCount: contextResult.body.data.actionableCount,
      localSessions: Array.isArray(contextResult.body.data.localSessions) ? contextResult.body.data.localSessions.length : 0
    }, null, 2));
  } else {
    console.log("\n[loop-ops] roomId not provided, skipping /api/status/context-debug");
  }

  const alertState = String(alertsResult.body.data?.state || "info");
  if (args.strictAlerts && (alertState === "warn" || alertState === "error")) {
    throw new Error(`Strict alerts enabled and state=${alertState}`);
  }

  console.log("\n[loop-ops] smoke check completed");
}

run().catch((error) => {
  console.error("[loop-ops] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
