import process from "node:process";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

const PRESETS = {
  canary10: {
    name: "canary10",
    payload: {
      agentLoopGuardEnabled: true,
      agentLoopGuardRolloutPercent: 10,
      agentLoopGuardNoActionStreak: 3,
      agentAlertsMinCycles: 10,
      agentAlertsMaxNoActionRate: 0.75,
      agentAlertsMaxReentryRate: 0.35
    }
  },
  canary50: {
    name: "canary50",
    payload: {
      agentLoopGuardEnabled: true,
      agentLoopGuardRolloutPercent: 50,
      agentLoopGuardNoActionStreak: 3,
      agentAlertsMinCycles: 10,
      agentAlertsMaxNoActionRate: 0.75,
      agentAlertsMaxReentryRate: 0.35
    }
  },
  full100: {
    name: "full100",
    payload: {
      agentLoopGuardEnabled: true,
      agentLoopGuardRolloutPercent: 100,
      agentLoopGuardNoActionStreak: 3,
      agentAlertsMinCycles: 10,
      agentAlertsMaxNoActionRate: 0.75,
      agentAlertsMaxReentryRate: 0.35
    }
  },
  rollback: {
    name: "rollback",
    payload: {
      agentLoopGuardEnabled: false,
      agentLoopGuardRolloutPercent: 0,
      agentLoopGuardNoActionStreak: 3,
      agentAlertsMinCycles: 10,
      agentAlertsMaxNoActionRate: 0.75,
      agentAlertsMaxReentryRate: 0.35
    }
  }
};

function usage() {
  console.log("Usage: node scripts/loop-rollout.mjs [options]");
  console.log("");
  console.log("Options:");
  console.log("  --base-url <url>            Node manager URL (default: http://127.0.0.1:3000)");
  console.log("  --token <jwt>               Session token for hexnest_node_session cookie");
  console.log("  --stages <csv>              Ordered rollout stages (default: canary10,canary50,full100)");
  console.log("  --samples <n>               Number of /loop-alerts samples per stage (default: 3)");
  console.log("  --interval-ms <ms>          Delay between stage samples (default: 10000)");
  console.log("  --allow-warn                Continue even if loop-alerts state is warn");
  console.log("  --skip-rollback             Do not apply rollback on gate failure");
  console.log("  --notify-webhook <url>      Webhook URL for stage and incident notifications");
  console.log("  --dry-run                   Print actions without changing config");
  console.log("  --help                      Show this help");
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    token: process.env.HEXNEST_USER_TOKEN || "",
    stages: ["canary10", "canary50", "full100"],
    samples: 3,
    intervalMs: 10_000,
    allowWarn: false,
    skipRollback: false,
    dryRun: false,
    help: false,
    webhook: process.env.HEXNEST_ALERT_WEBHOOK_URL || ""
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--help") {
      args.help = true;
      continue;
    }
    if (arg === "--allow-warn") {
      args.allowWarn = true;
      continue;
    }
    if (arg === "--skip-rollback") {
      args.skipRollback = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "--base-url" && next) {
      args.baseUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--token" && next) {
      args.token = next;
      i += 1;
      continue;
    }
    if (arg === "--stages" && next) {
      args.stages = next.split(",").map((v) => v.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === "--samples" && next) {
      args.samples = Math.max(1, Number.parseInt(next, 10) || 3);
      i += 1;
      continue;
    }
    if (arg === "--interval-ms" && next) {
      args.intervalMs = Math.max(1000, Number.parseInt(next, 10) || 10_000);
      i += 1;
      continue;
    }
    if (arg === "--notify-webhook" && next) {
      args.webhook = next;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
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
      body = { success: false, error: `Invalid JSON at ${path}` };
    }

    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function postWebhook(url, payload) {
  if (!String(url || "").trim()) {
    return;
  }

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn("[loop-rollout] webhook notify failed:", error instanceof Error ? error.message : String(error));
  }
}

function ensureApiSuccess(result, path) {
  if (!result.ok || !result.body?.success) {
    throw new Error(`${path} failed: HTTP ${result.status} ${result.body?.error || "unknown error"}`);
  }
}

async function applyPreset(baseUrl, headers, stageName, dryRun) {
  const preset = PRESETS[stageName];
  if (!preset) {
    throw new Error(`Unknown stage: ${stageName}`);
  }

  if (dryRun) {
    console.log(`[loop-rollout] [dry-run] apply ${stageName}`);
    console.log(JSON.stringify(preset.payload, null, 2));
    return;
  }

  const patchResult = await requestJson(baseUrl, "/api/config", {
    method: "PATCH",
    headers,
    body: JSON.stringify(preset.payload)
  });
  ensureApiSuccess(patchResult, "/api/config PATCH");
  console.log(`[loop-rollout] applied stage ${stageName}`);
}

async function sampleAlerts(baseUrl, headers, samples, intervalMs, dryRun) {
  const snapshots = [];

  for (let i = 0; i < samples; i += 1) {
    if (dryRun) {
      snapshots.push({ state: "ready", summary: "dry-run", totalCycles: 0, checks: [] });
    } else {
      const status = await requestJson(baseUrl, "/api/status", { method: "GET", headers });
      ensureApiSuccess(status, "/api/status");

      const alerts = await requestJson(baseUrl, "/api/status/loop-alerts", { method: "GET", headers });
      ensureApiSuccess(alerts, "/api/status/loop-alerts");

      snapshots.push({
        state: alerts.body.data?.state || "info",
        summary: alerts.body.data?.summary || "",
        totalCycles: alerts.body.data?.totalCycles || 0,
        checks: alerts.body.data?.checks || [],
        rolloutPercent: status.body.data?.loopGuardRolloutPercent,
        actedCycles: status.body.data?.actedCycles,
        noActionCycles: status.body.data?.noActionCycles,
        reentryWithoutProgress: status.body.data?.reentryWithoutProgress
      });

      console.log(`[loop-rollout] sample ${i + 1}/${samples}: state=${alerts.body.data?.state} totalCycles=${alerts.body.data?.totalCycles}`);
    }

    if (i < samples - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return snapshots;
}

function evaluateGate(snapshots, allowWarn) {
  if (snapshots.length === 0) {
    return { pass: false, reason: "no snapshots" };
  }

  const bad = snapshots.find((snapshot) => snapshot.state === "error" || (!allowWarn && snapshot.state === "warn"));
  if (bad) {
    return {
      pass: false,
      reason: `state=${bad.state} summary=${bad.summary}`
    };
  }

  return { pass: true, reason: "all samples passed" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  for (const stageName of args.stages) {
    if (!PRESETS[stageName]) {
      throw new Error(`Unsupported stage in --stages: ${stageName}`);
    }
  }

  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const headers = buildHeaders(args.token);

  if (!String(args.token || "").trim() && !args.dryRun) {
    throw new Error("Missing token. Pass --token or set HEXNEST_USER_TOKEN.");
  }

  const startedAt = new Date().toISOString();
  console.log(`[loop-rollout] start ${startedAt}`);
  console.log(`[loop-rollout] stages=${args.stages.join(" -> ")} samples=${args.samples} intervalMs=${args.intervalMs}`);

  await postWebhook(args.webhook, {
    source: "hexnest-node-loop-rollout",
    event: "start",
    startedAt,
    baseUrl,
    stages: args.stages
  });

  let completedStage = "none";

  for (const stageName of args.stages) {
    console.log(`\n[loop-rollout] stage ${stageName}`);
    await applyPreset(baseUrl, headers, stageName, args.dryRun);

    const snapshots = await sampleAlerts(baseUrl, headers, args.samples, args.intervalMs, args.dryRun);
    const gate = evaluateGate(snapshots, args.allowWarn);

    await postWebhook(args.webhook, {
      source: "hexnest-node-loop-rollout",
      event: "stage_result",
      stage: stageName,
      pass: gate.pass,
      reason: gate.reason,
      snapshots
    });

    if (!gate.pass) {
      console.error(`[loop-rollout] gate failed on ${stageName}: ${gate.reason}`);
      if (!args.skipRollback) {
        console.log("[loop-rollout] applying rollback");
        await applyPreset(baseUrl, headers, "rollback", args.dryRun);
      }
      await postWebhook(args.webhook, {
        source: "hexnest-node-loop-rollout",
        event: "failed",
        stage: stageName,
        rollbackApplied: !args.skipRollback,
        reason: gate.reason
      });
      process.exit(1);
    }

    completedStage = stageName;
    console.log(`[loop-rollout] stage ${stageName} passed`);
  }

  console.log(`\n[loop-rollout] completed successfully, final stage=${completedStage}`);
  await postWebhook(args.webhook, {
    source: "hexnest-node-loop-rollout",
    event: "completed",
    finalStage: completedStage
  });
}

main().catch(async (error) => {
  console.error("[loop-rollout] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
