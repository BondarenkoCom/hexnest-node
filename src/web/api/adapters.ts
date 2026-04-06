import { Router, Request, Response } from "express";
import { WebServerContext } from "../server.js";
import { ApiResponse, AdapterInfo } from "../types.js";

export function adaptersRouter(context: WebServerContext) {
  const router = Router();

  // Get adapter config
  router.get("/:type", (req: Request, res: Response) => {
    try {
      const config = context.db.getAdapterConfig(req.params.type);
      if (!config) {
        res.status(404).json({
          success: false,
          error: `Adapter ${req.params.type} not configured`
        });
        return;
      }

      const response: ApiResponse<AdapterInfo> = {
        success: true,
        data: {
          id: config.id,
          type: config.type,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl
        }
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Save adapter config
  router.post("/:type", (req: Request, res: Response) => {
    try {
      const { apiKey, baseUrl } = req.body;
      const type = req.params.type;

      const config = context.db.saveAdapterConfig(type, apiKey, baseUrl);

      const response: ApiResponse<AdapterInfo> = {
        success: true,
        data: {
          id: config.id,
          type: config.type,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl
        }
      };
      res.status(201).json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Delete adapter config
  router.delete("/:type", (req: Request, res: Response) => {
    try {
      const type = req.params.type;
      const success = context.db.deleteAdapterConfig(type);
      
      if (success) {
        res.json({ success: true });
      } else {
        res.status(500).json({
          success: false,
          error: `Failed to delete adapter ${type}`
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  return router;
}
