import { Router, Request, Response } from "express";
import { WebServerContext } from "../server.js";
import { ApiResponse, NodeStatus } from "../types.js";

export function statusRouter(context: WebServerContext) {
  const router = Router();

  // Get node status
  router.get("/", (req: Request, res: Response) => {
    try {
      const identity = context.db.getNodeIdentity();
      const nodeStatus = context.getNodeStatus();

      const status: NodeStatus = {
        id: identity?.id ?? null,
        name: context.nodeConfig.nodeName,
        operatorName: context.nodeConfig.operatorName,
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
