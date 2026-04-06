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

function normalizeCoreUrl(value: string): string {
  return value.replace(/\/+$/, "").trim();
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
      const configuredCoreUrl = context.nodeConfig.coreUrl;
      const requestedCoreUrl = typeof req.body?.coreUrl === "string" ? req.body.coreUrl.trim() : "";
      const testUrl = configuredCoreUrl;

      if (!testUrl) {
        res.status(400).json({
          success: false,
          error: "Core connection is not configured in node settings"
        });
        return;
      }

      if (requestedCoreUrl && normalizeCoreUrl(requestedCoreUrl) !== normalizeCoreUrl(configuredCoreUrl)) {
        res.status(400).json({
          success: false,
          error: "Core URL is fixed in node configuration and cannot be changed from the web UI"
        });
        return;
      }

      // Test connection by making a simple health check
      try {
        const controller = new AbortController();
        const timeoutMs = context.nodeConfig.httpTimeoutMs || 20_000;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(`${testUrl.replace(/\/$/, "")}/health`, {
          method: "GET",
          signal: controller.signal
        });
        clearTimeout(timeout);

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
        const message = fetchError instanceof Error && fetchError.name === "AbortError"
          ? `Connection timed out after ${context.nodeConfig.httpTimeoutMs || 20_000}ms`
          : fetchError instanceof Error
            ? fetchError.message
            : "Unknown error";
        res.json({
          success: false,
          message: `❌ Connection failed: ${message}`,
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
      const configuredCoreUrl = context.nodeConfig.coreUrl;
      const requestedCoreUrl = typeof req.body?.coreUrl === "string" ? req.body.coreUrl.trim() : "";
      const { userToken, userEmail } = req.body;

      if (requestedCoreUrl && normalizeCoreUrl(requestedCoreUrl) !== normalizeCoreUrl(configuredCoreUrl)) {
        res.status(400).json({
          success: false,
          error: "Core URL is fixed in node configuration and cannot be changed from the web UI"
        });
        return;
      }

      const result = await context.reconnectToCore({ userToken, userEmail });
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

  router.delete("/node", async (_req: Request, res: Response) => {
    try {
      const result = await context.removeNodeFromCore();
      res.json({
        success: true,
        removed: result.removed,
        nodeId: result.nodeId,
        message: result.nodeId ? "Node removed from HexNest Core" : "Node is already detached from core"
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
