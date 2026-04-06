import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { WebServerContext } from "../server.js";
import { ApiResponse, ModelInfo } from "../types.js";

export function modelsRouter(context: WebServerContext) {
  const router = Router();

  // List all models
  router.get("/", (req: Request, res: Response) => {
    try {
      const models = context.db.getModelConfigs();
      const response: ApiResponse<ModelInfo[]> = {
        success: true,
        data: models.map((m) => ({
          id: m.id,
          name: m.name,
          type: m.type,
          model: m.model,
          baseUrl: m.baseUrl,
          roles: m.roles,
          capabilities: m.capabilities,
          enabled: m.enabled,
          active: m.active
        }))
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get specific model
  router.get("/:name", (req: Request, res: Response) => {
    try {
      const model = context.db.getModelConfig(req.params.name);
      if (!model) {
        res.status(404).json({
          success: false,
          error: `Model ${req.params.name} not found`
        });
        return;
      }
      const response: ApiResponse<ModelInfo> = {
        success: true,
        data: {
          id: model.id,
          name: model.name,
          type: model.type,
          model: model.model,
          baseUrl: model.baseUrl,
          roles: model.roles,
          capabilities: model.capabilities,
          enabled: model.enabled,
          active: model.active
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

  // Test connection
  router.post("/test", async (req: Request, res: Response) => {
    try {
      const { adapter, model, baseUrl, apiKey } = req.body;

      if (!adapter || !model) {
        res.status(400).json({
          success: false,
          error: "adapter and model are required"
        });
        return;
      }

      // Test based on adapter type
      if (adapter === "ClaudeAdapter") {
        if (!apiKey) {
          res.status(400).json({ success: false, error: "API key is required for Claude" });
          return;
        }
        
        try {
          // Simple test: make a test request to Claude API
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json"
            },
            body: JSON.stringify({
              model: model,
              max_tokens: 100,
              messages: [{ role: "user", content: "test" }]
            })
          });

          if (response.ok) {
            res.json({ success: true });
          } else {
            const error = await response.json();
            res.json({
              success: false,
              error: error.error?.message || "API key invalid or rate limited"
            });
          }
        } catch (err) {
          res.json({
            success: false,
            error: `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`
          });
        }
      } else if (adapter === "OpenAIAdapter") {
        if (!apiKey) {
          res.status(400).json({ success: false, error: "API key is required for OpenAI" });
          return;
        }

        try {
          const url = baseUrl || "https://api.openai.com/v1";
          const response = await fetch(`${url}/models/${model}`, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "content-type": "application/json"
            }
          });

          if (response.ok) {
            res.json({ success: true });
          } else {
            const error = await response.json();
            res.json({
              success: false,
              error: error.error?.message || "API key invalid or model not found"
            });
          }
        } catch (err) {
          res.json({
            success: false,
            error: `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`
          });
        }
      } else if (adapter === "OllamaAdapter") {
        try {
          const url = baseUrl || "http://localhost:11434";
          const response = await fetch(`${url}/api/tags`, {
            method: "GET",
            headers: { "content-type": "application/json" }
          });

          if (response.ok) {
            const data = await response.json();
            const hasModel = data.models?.some(
              (m: { name: string }) => m.name.includes(model) || m.name.startsWith(model)
            );

            if (hasModel) {
              res.json({ success: true });
            } else {
              res.json({
                success: false,
                error: `Model "${model}" not found in Ollama. Available: ${data.models?.map((m: { name: string }) => m.name).join(", ") || "none"}`
              });
            }
          } else {
            res.json({
              success: false,
              error: `Ollama server not accessible at ${url}`
            });
          }
        } catch (err) {
          res.json({
            success: false,
            error: `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`
          });
        }
      } else {
        res.status(400).json({
          success: false,
          error: "Unknown adapter type"
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Test connection and get available models list
  router.post("/test-list", async (req: Request, res: Response) => {
    try {
      const { adapter, baseUrl, apiKey } = req.body;

      if (!adapter) {
        res.status(400).json({
          success: false,
          error: "adapter is required"
        });
        return;
      }

      // Get models based on adapter type
      if (adapter === "ClaudeAdapter") {
        if (!apiKey) {
          res.status(400).json({ success: false, error: "API key is required for Claude" });
          return;
        }
        
        try {
          // Test connection first
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json"
            },
            body: JSON.stringify({
              model: "claude-3-opus-20250219",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }]
            })
          });

          if (!response.ok) {
            const error = await response.json();
            if (response.status === 401) {
              res.json({
                success: false,
                error: "Invalid API key for Claude"
              });
            } else {
              res.json({
                success: false,
                error: error.error?.message || `Claude API error: ${response.status}`
              });
            }
            return;
          }

          // Return available Claude models
          const claudeModels = [
            "claude-3-opus-20250219",
            "claude-3-5-sonnet-20241022",
            "claude-3-haiku-20250307"
          ];

          res.json({
            success: true,
            models: claudeModels
          });
        } catch (error) {
          res.json({
            success: false,
            error: error instanceof Error ? error.message : "Claude API test failed"
          });
        }
      } else if (adapter === "OpenAIAdapter") {
        if (!apiKey) {
          res.status(400).json({ success: false, error: "API key is required for OpenAI" });
          return;
        }

        try {
          const url = new URL("/models", baseUrl || "https://api.openai.com/v1");
          const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            }
          });

          if (!response.ok) {
            const error = await response.json();
            if (response.status === 401) {
              res.json({
                success: false,
                error: "Invalid OpenAI API key"
              });
            } else {
              res.json({
                success: false,
                error: error.error?.message || `OpenAI API error: ${response.status}`
              });
            }
            return;
          }

          const data: any = await response.json();
          const models = data.data
            .filter((m: any) => m.owned_by?.includes("openai") || m.id.includes("gpt"))
            .map((m: any) => m.id)
            .sort();

          res.json({
            success: true,
            models: models.slice(0, 20) // Limit to top 20 models
          });
        } catch (error) {
          res.json({
            success: false,
            error: error instanceof Error ? error.message : "OpenAI API test failed"
          });
        }
      } else if (adapter === "OllamaAdapter") {
        try {
          const url = new URL("/api/tags", baseUrl || "http://localhost:11434");
          const response = await fetch(url.toString());

          if (!response.ok) {
            res.json({
              success: false,
              error: `Ollama server not responding: ${response.status}`
            });
            return;
          }

          const data: any = await response.json();
          const models = data.models?.map((m: any) => m.name) || [];

          if (models.length === 0) {
            res.json({
              success: false,
              error: "No models found in Ollama. Pull some models first (e.g., ollama pull llama2)"
            });
            return;
          }

          res.json({
            success: true,
            models: models
          });
        } catch (error) {
          res.json({
            success: false,
            error: error instanceof Error ? error.message : "Ollama connection failed"
          });
        }
      } else {
        res.status(400).json({
          success: false,
          error: `Unknown adapter: ${adapter}`
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Create new model
  router.post("/", (req: Request, res: Response) => {
    try {
      // Support both new format { name, adapter, config } and old format { type, name, model, ... }
      const { type, adapter, name, model, config, baseUrl, apiKey, apiKeyEnv, roles, capabilities } = req.body;
      
      // Extract values from new format if provided
      const adapterType = adapter || type;
      const modelName = config?.model || model;
      const modelBaseUrl = config?.baseUrl || baseUrl;
      const modelApiKey = config?.apiKey || apiKey;

      if (!adapterType || !name || !modelName) {
        res.status(400).json({
          success: false,
          error: "adapter/type, name, and model are required"
        });
        return;
      }

      const existing = context.db.getModelConfig(name);
      if (existing) {
        res.status(409).json({
          success: false,
          error: `Model ${name} already exists`
        });
        return;
      }

      const newModel = context.db.addModelConfig({
        id: randomUUID(),
        type: adapterType,
        name,
        model: modelName,
        baseUrl: modelBaseUrl,
        apiKey: modelApiKey,
        apiKeyEnv,
        roles,
        capabilities,
        enabled: true,
        active: false // Will be set to true if it's the first one
      });

      // If this is the first model of this adapter type, make it active
      const allModels = context.db.getModelConfigs().filter(m => m.type === adapterType);
      if (allModels.length === 1) {
        context.db.setActiveModel(newModel.name, adapterType);
      }

      const response: ApiResponse<ModelInfo> = {
        success: true,
        data: {
          id: newModel.id,
          name: newModel.name,
          type: newModel.type,
          model: newModel.model,
          baseUrl: newModel.baseUrl,
          roles: newModel.roles,
          capabilities: newModel.capabilities,
          enabled: newModel.enabled,
          active: newModel.active || allModels.length === 1
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

  // Update model
  router.patch("/:name", (req: Request, res: Response) => {
    try {
      const existing = context.db.getModelConfig(req.params.name);
      if (!existing) {
        res.status(404).json({
          success: false,
          error: `Model ${req.params.name} not found`
        });
        return;
      }

      const updated = context.db.updateModelConfig(req.params.name, req.body);
      if (!updated) {
        res.status(500).json({
          success: false,
          error: "Failed to update model"
        });
        return;
      }

      const response: ApiResponse<ModelInfo> = {
        success: true,
        data: {
          id: updated.id,
          name: updated.name,
          type: updated.type,
          model: updated.model,
          baseUrl: updated.baseUrl,
          roles: updated.roles,
          capabilities: updated.capabilities,
          enabled: updated.enabled,
          active: updated.active
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

  // Delete model
  router.delete("/:name", (req: Request, res: Response) => {
    try {
      const deleted = context.db.deleteModelConfig(req.params.name);
      if (!deleted) {
        res.status(404).json({
          success: false,
          error: `Model ${req.params.name} not found`
        });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Activate model (set as default for its adapter type)
  router.put("/:name/activate", (req: Request, res: Response) => {
    try {
      const model = context.db.getModelConfig(req.params.name);
      if (!model) {
        res.status(404).json({
          success: false,
          error: `Model ${req.params.name} not found`
        });
        return;
      }

      const success = context.db.setActiveModel(model.name, model.type);
      if (!success) {
        res.status(500).json({
          success: false,
          error: "Failed to activate model"
        });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  return router;
}
