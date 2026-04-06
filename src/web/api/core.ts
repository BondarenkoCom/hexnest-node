import { Router, Request, Response } from "express";
import { WebServerContext } from "../server.js";
import { ApiResponse } from "../types.js";

export interface CoreInfo {
  coreUrl: string;
  coreConnected: boolean;
  connectionReason: string | null;
  nodeName: string;
  nodeId: string | null;
}

export interface CoreConnectionResult {
  success: boolean;
  message?: string;
  coreUrl?: string;
  coreConnected?: boolean;
}

export function coreRouter(context: WebServerContext) {
  const router = Router();

  // Get current core config
  router.get("/", (req: Request, res: Response) => {
    try {
      const nodeStatus = context.getNodeStatus();
      const coreInfo: CoreInfo = {
        coreUrl: context.nodeConfig.coreUrl,
        coreConnected: nodeStatus.coreConnected,
        connectionReason: nodeStatus.coreConnectionReason,
        nodeName: context.nodeConfig.nodeName,
        nodeId: nodeStatus.id
      };

      const response: ApiResponse<CoreInfo> = {
        success: true,
        data: coreInfo
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Test connection to core
  router.post("/test", async (req: Request, res: Response) => {
    try {
      const { coreUrl } = req.body;
      const testUrl = coreUrl || context.nodeConfig.coreUrl;

      if (!testUrl) {
        res.status(400).json({
          success: false,
          error: "Core connection is not configured in node settings"
        });
        return;
      }

      // Test connection by making a simple health check
      try {
        const response = await fetch(`${testUrl.replace(/\/$/, "")}/health`, {
          method: "GET",
          timeout: context.nodeConfig.httpTimeoutMs || 20_000
        });

        if (response.ok) {
          res.json({
            success: true,
            message: "✅ Connection to HexNest Core successful",
            coreUrl: testUrl,
            coreConnected: true
          });
        } else {
          res.json({
            success: false,
            message: `❌ Core returned status ${response.status}`,
            coreUrl: testUrl
          });
        }
      } catch (fetchError) {
        res.json({
          success: false,
          message: `❌ Connection failed: ${fetchError instanceof Error ? fetchError.message : "Unknown error"}`,
          coreUrl: testUrl
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Reconnect to core using the current runtime and optional updated core URL
  router.post("/reconnect", async (req: Request, res: Response) => {
    try {
      const { coreUrl, userToken, userEmail } = req.body;
      const result = await context.reconnectToCore(coreUrl, { userToken, userEmail });
      res.json({
        success: true,
        message: result.coreConnected ? "Connected to HexNest Core" : "Node is still in local mode",
        coreUrl: result.coreUrl,
        coreConnected: result.coreConnected,
        nodeId: result.nodeId
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  return router;
}
