import { Router, Request, Response } from "express";
import { WebServerContext } from "../server.js";
import { ApiResponse, NodeConfigInfo } from "../types.js";

export function configRouter(context: WebServerContext) {
  const router = Router();

  // Get current config
  router.get("/", (req: Request, res: Response) => {
    try {
      const config: NodeConfigInfo = {
        heartbeatIntervalMs: context.nodeConfig.heartbeatIntervalMs,
        approvalPollIntervalMs: context.nodeConfig.approvalPollIntervalMs,
        usageFlushIntervalMs: context.nodeConfig.usageFlushIntervalMs,
        maxUsageBatch: context.nodeConfig.maxUsageBatch,
        shutdownGraceMs: context.nodeConfig.shutdownGraceMs,
        autoAcceptInvites: context.nodeConfig.autoAcceptInvites,
        httpTimeoutMs: context.nodeConfig.httpTimeoutMs,
        agentLoopGuardEnabled: context.nodeConfig.agentLoopGuardEnabled,
        agentLoopGuardRolloutPercent: context.nodeConfig.agentLoopGuardRolloutPercent,
        agentLoopGuardNoActionStreak: context.nodeConfig.agentLoopGuardNoActionStreak,
        agentAlertsMinCycles: context.nodeConfig.agentAlertsMinCycles,
        agentAlertsMaxNoActionRate: context.nodeConfig.agentAlertsMaxNoActionRate,
        agentAlertsMaxReentryRate: context.nodeConfig.agentAlertsMaxReentryRate
      };
      const response: ApiResponse<NodeConfigInfo> = {
        success: true,
        data: config
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Update config (note: some fields like heartbeat intervals might require restart)
  router.patch("/", (req: Request, res: Response) => {
    try {
      const {
        heartbeatIntervalMs,
        approvalPollIntervalMs,
        usageFlushIntervalMs,
        maxUsageBatch,
        shutdownGraceMs,
        autoAcceptInvites,
        httpTimeoutMs,
        agentLoopGuardEnabled,
        agentLoopGuardRolloutPercent,
        agentLoopGuardNoActionStreak,
        agentAlertsMinCycles,
        agentAlertsMaxNoActionRate,
        agentAlertsMaxReentryRate
      } = req.body;

      // Store in database
      if (heartbeatIntervalMs !== undefined) {
        context.db.setNodeConfig("heartbeatIntervalMs", String(heartbeatIntervalMs));
      }
      if (approvalPollIntervalMs !== undefined) {
        context.db.setNodeConfig("approvalPollIntervalMs", String(approvalPollIntervalMs));
      }
      if (usageFlushIntervalMs !== undefined) {
        context.db.setNodeConfig("usageFlushIntervalMs", String(usageFlushIntervalMs));
      }
      if (maxUsageBatch !== undefined) {
        context.db.setNodeConfig("maxUsageBatch", String(maxUsageBatch));
      }
      if (shutdownGraceMs !== undefined) {
        context.db.setNodeConfig("shutdownGraceMs", String(shutdownGraceMs));
      }
      if (autoAcceptInvites !== undefined) {
        context.db.setNodeConfig("autoAcceptInvites", String(autoAcceptInvites));
      }
      if (httpTimeoutMs !== undefined) {
        context.db.setNodeConfig("httpTimeoutMs", String(httpTimeoutMs));
      }
      if (agentLoopGuardEnabled !== undefined) {
        context.db.setNodeConfig("agent_loop_guard_enabled", String(agentLoopGuardEnabled));
      }
      if (agentLoopGuardRolloutPercent !== undefined) {
        context.db.setNodeConfig("agent_loop_guard_rollout_percent", String(agentLoopGuardRolloutPercent));
      }
      if (agentLoopGuardNoActionStreak !== undefined) {
        context.db.setNodeConfig("agent_loop_guard_no_action_streak", String(agentLoopGuardNoActionStreak));
      }
      if (agentAlertsMinCycles !== undefined) {
        context.db.setNodeConfig("agent_alerts_min_cycles", String(agentAlertsMinCycles));
      }
      if (agentAlertsMaxNoActionRate !== undefined) {
        context.db.setNodeConfig("agent_alerts_max_no_action_rate", String(agentAlertsMaxNoActionRate));
      }
      if (agentAlertsMaxReentryRate !== undefined) {
        context.db.setNodeConfig("agent_alerts_max_reentry_rate", String(agentAlertsMaxReentryRate));
      }

      // Return updated config
      const config: NodeConfigInfo = {
        heartbeatIntervalMs: heartbeatIntervalMs ?? context.nodeConfig.heartbeatIntervalMs,
        approvalPollIntervalMs: approvalPollIntervalMs ?? context.nodeConfig.approvalPollIntervalMs,
        usageFlushIntervalMs: usageFlushIntervalMs ?? context.nodeConfig.usageFlushIntervalMs,
        maxUsageBatch: maxUsageBatch ?? context.nodeConfig.maxUsageBatch,
        shutdownGraceMs: shutdownGraceMs ?? context.nodeConfig.shutdownGraceMs,
        autoAcceptInvites: autoAcceptInvites ?? context.nodeConfig.autoAcceptInvites,
        httpTimeoutMs: httpTimeoutMs ?? context.nodeConfig.httpTimeoutMs,
        agentLoopGuardEnabled: agentLoopGuardEnabled ?? context.nodeConfig.agentLoopGuardEnabled,
        agentLoopGuardRolloutPercent: agentLoopGuardRolloutPercent ?? context.nodeConfig.agentLoopGuardRolloutPercent,
        agentLoopGuardNoActionStreak: agentLoopGuardNoActionStreak ?? context.nodeConfig.agentLoopGuardNoActionStreak,
        agentAlertsMinCycles: agentAlertsMinCycles ?? context.nodeConfig.agentAlertsMinCycles,
        agentAlertsMaxNoActionRate: agentAlertsMaxNoActionRate ?? context.nodeConfig.agentAlertsMaxNoActionRate,
        agentAlertsMaxReentryRate: agentAlertsMaxReentryRate ?? context.nodeConfig.agentAlertsMaxReentryRate
      };

      const response: ApiResponse<NodeConfigInfo> = {
        success: true,
        data: config
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
