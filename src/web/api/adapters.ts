import { Router, Request, Response } from "express";
import { WebServerContext } from "../server.js";
import { ApiResponse, AdapterInfo } from "../types.js";
import { loadEnvMap } from "../../config.js";

const KNOWN_ADAPTER_TYPES = ["ClaudeAdapter", "OpenAIAdapter", "OllamaAdapter"] as const;

function getFallbackAdapterConfig(type: string, forList = false): AdapterInfo | null {
  const env = loadEnvMap();

  if (type === "OllamaAdapter") {
    return {
      id: "env:OllamaAdapter",
      type,
      baseUrl: env.OLLAMA_BASE_URL || "http://localhost:11434"
    };
  }

  if (type === "OpenAIAdapter") {
    if (forList && !env.OPENAI_API_KEY && !env.OPENAI_BASE_URL) {
      return null;
    }

    return {
      id: "env:OpenAIAdapter",
      type,
      apiKey: env.OPENAI_API_KEY || undefined,
      baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1"
    };
  }

  if (type === "ClaudeAdapter") {
    if (forList && !env.ANTHROPIC_API_KEY && !env.ANTHROPIC_BASE_URL) {
      return null;
    }

    return {
      id: "env:ClaudeAdapter",
      type,
      apiKey: env.ANTHROPIC_API_KEY || undefined,
      baseUrl: env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1"
    };
  }

  return null;
}

export function adaptersRouter(context: WebServerContext) {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    try {
      const data = KNOWN_ADAPTER_TYPES
        .map((type) => context.db.getAdapterConfig(type) || getFallbackAdapterConfig(type, true))
        .filter((config): config is AdapterInfo => Boolean(config));

      const response: ApiResponse<AdapterInfo[]> = {
        success: true,
        data
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get adapter config
  router.get("/:type", (req: Request, res: Response) => {
    try {
      const config = context.db.getAdapterConfig(req.params.type) || getFallbackAdapterConfig(req.params.type, false);
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
