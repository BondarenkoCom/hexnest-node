import { Router, Request, Response } from "express";
import { WebServerContext } from "../server.js";
import { ApiResponse, NodeReadiness, NodeStatus, ReadinessCheck, ReadinessState } from "../types.js";

const PROVIDERS = [
  { type: "ClaudeAdapter", label: "Claude" },
  { type: "OpenAIAdapter", label: "OpenAI" },
  { type: "OllamaAdapter", label: "Ollama" }
] as const;

function rankState(state: ReadinessState): number {
  switch (state) {
    case "error":
      return 3;
    case "warn":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}

async function probeCoreHealth(context: WebServerContext): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timeoutMs = Math.min(Math.max(2_000, Math.round(context.nodeConfig.httpTimeoutMs / 2)), 5_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${context.nodeConfig.coreUrl.replace(/\/+$/, "")}/health`, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return { ok: false, detail: `Core responded with HTTP ${response.status}` };
    }
    return { ok: true, detail: "Core health endpoint is reachable" };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, detail: `Core health check timed out after ${timeoutMs}ms` };
    }
    return { ok: false, detail: error instanceof Error ? error.message : "Core health probe failed" };
  }
}

async function buildReadiness(context: WebServerContext): Promise<NodeReadiness> {
  const nodeStatus = context.getNodeStatus();
  const operatorEmail = context.db.getNodeConfig("user_email");
  const models = context.db.getModelConfigs();
  const enabledModels = models.filter((model) => model.enabled);
  const activeModel = enabledModels.find((model) => model.active) ?? null;
  const configuredProviders = PROVIDERS.filter((provider) => context.db.getAdapterConfig(provider.type));
  const coreHealth = await probeCoreHealth(context);
  const checks: ReadinessCheck[] = [];

  checks.push({
    id: "operator-session",
    label: "Operator account",
    state: operatorEmail ? "ready" : "warn",
    summary: operatorEmail ? `Signed in as ${operatorEmail}` : "Node manager is not linked to an operator account",
    detail: operatorEmail
      ? "Authenticated owner actions can reconnect, reset, and remove this node."
      : "Sign in to attach the node to your HexNest account and use core operations."
  });

  checks.push({
    id: "core-reachability",
    label: "Core reachability",
    state: nodeStatus.coreConnected ? "ready" : (coreHealth.ok ? "warn" : "error"),
    summary: nodeStatus.coreConnected
      ? "Runtime is attached to HexNest Core"
      : (coreHealth.ok ? "Core is reachable, but this node is running locally" : "Core is not reachable from this node"),
    detail: nodeStatus.coreConnectionReason || coreHealth.detail
  });

  checks.push({
    id: "node-identity",
    label: "Node identity",
    state: nodeStatus.id ? "ready" : "warn",
    summary: nodeStatus.id ? `Registered as ${nodeStatus.id}` : "No node identity is stored locally",
    detail: nodeStatus.id
      ? "Reconnect will reuse the current identity unless you reset it."
      : "The next successful reconnect will register a fresh node identity in core."
  });

  checks.push({
    id: "models",
    label: "Model readiness",
    state: activeModel ? "ready" : (enabledModels.length > 0 ? "warn" : "error"),
    summary: activeModel
      ? `Active model: ${activeModel.name}`
      : (enabledModels.length > 0 ? "Models exist, but no enabled model is active" : "No enabled models configured"),
    detail: enabledModels.length > 0
      ? `${enabledModels.length} enabled model${enabledModels.length === 1 ? "" : "s"} available for routing.`
      : "Open Models and configure at least one active provider/model pair."
  });

  checks.push({
    id: "providers",
    label: "Provider coverage",
    state: configuredProviders.length > 0 ? "info" : "warn",
    summary: configuredProviders.length > 0
      ? `${configuredProviders.length} provider${configuredProviders.length === 1 ? "" : "s"} configured`
      : "No provider credentials or base URLs stored",
    detail: configuredProviders.length > 0
      ? `Configured providers: ${configuredProviders.map((provider) => provider.label).join(", ")}`
      : "Add Claude, OpenAI, or Ollama access in the Models section."
  });

  const heartbeatAgeMs = nodeStatus.lastHeartbeatAt ? Date.now() - Date.parse(nodeStatus.lastHeartbeatAt) : null;
  const heartbeatHealthy =
    nodeStatus.coreConnected && heartbeatAgeMs !== null && heartbeatAgeMs <= nodeStatus.heartbeatIntervalMs * 2.5;
  checks.push({
    id: "heartbeat",
    label: "Heartbeat freshness",
    state: nodeStatus.coreConnected ? (heartbeatHealthy ? "ready" : "warn") : "info",
    summary: nodeStatus.coreConnected
      ? (heartbeatHealthy ? "Heartbeat is fresh" : "Heartbeat is stale or still waiting")
      : "Heartbeat is paused while node is in local mode",
    detail: nodeStatus.lastHeartbeatAt
      ? `Last heartbeat at ${new Date(nodeStatus.lastHeartbeatAt).toLocaleString()}`
      : "No heartbeat has been sent since the current session started."
  });

  const state = checks.reduce<ReadinessState>((current, check) =>
    rankState(check.state) > rankState(current) ? check.state : current,
  "ready");

  const summary = state === "error"
    ? "Node is not ready for dependable remote work"
    : state === "warn"
      ? "Node is partly ready, but still has gaps before stable core work"
      : state === "info"
        ? "Node is available with informational follow-up items"
        : "Node is ready for normal HexNest operation";

  const recommendedAction = !operatorEmail
    ? "Sign in with the operator account used for this node."
    : !nodeStatus.coreConnected && coreHealth.ok
      ? "Reconnect the node to HexNest Core."
      : !nodeStatus.id
        ? "Reconnect the node to register a fresh identity."
        : !activeModel
          ? "Open Models and activate at least one enabled model."
          : "No immediate action required.";

  return {
    state,
    summary,
    recommendedAction,
    mode: nodeStatus.coreConnected ? "connected" : "local",
    nodeId: nodeStatus.id,
    operatorEmail,
    activeModelName: activeModel?.name ?? null,
    enabledModelsCount: enabledModels.length,
    configuredProvidersCount: configuredProviders.length,
    checks,
    recentActivity: context.getRecentActivity()
  };
}

export function statusRouter(context: WebServerContext) {
  const router = Router();

  router.get("/readiness", async (_req: Request, res: Response) => {
    try {
      const readiness = await buildReadiness(context);
      const response: ApiResponse<NodeReadiness> = {
        success: true,
        data: readiness
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get node status
  router.get("/", (req: Request, res: Response) => {
    try {
      const identity = context.db.getNodeIdentity();
      const nodeStatus = context.getNodeStatus();

      const status: NodeStatus = {
        id: identity?.id ?? null,
        name: context.nodeConfig.nodeName,
        operatorName: context.nodeConfig.operatorName,
        operatorEmail: context.db.getNodeConfig("user_email"),
        isRunning: nodeStatus.isRunning,
        uptime: nodeStatus.uptime,
        adaptersCount: nodeStatus.adaptersCount,
        coreConnected: nodeStatus.coreConnected,
        coreConnectionReason: nodeStatus.coreConnectionReason,
        runtimeStatus: nodeStatus.runtimeStatus,
        heartbeatIntervalMs: nodeStatus.heartbeatIntervalMs,
        lastHeartbeatAt: nodeStatus.lastHeartbeatAt,
        activeRoomsCount: nodeStatus.activeRoomsCount,
        pendingUsageRecords: nodeStatus.pendingUsageRecords
      };

      const response: ApiResponse<NodeStatus> = {
        success: true,
        data: status
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  return router;
}
