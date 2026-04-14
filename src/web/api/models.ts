import { Router, Request, Response } from "express";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { loadEnvMap } from "../../config.js";
import { WebServerContext } from "../server.js";
import { ApiResponse, ModelInfo } from "../types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_CODEX_MODELS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"];

function resolveCodexCliPath(env: Record<string, string>): string {
  return String(env.CODEX_CLI_PATH || process.env.CODEX_CLI_PATH || "codex").trim() || "codex";
}

async function checkCodexCliReady(env: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  const codexPath = resolveCodexCliPath(env);
  try {
    const { stdout, stderr } = await execFileAsync(codexPath, ["login", "status"], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    const output = `${stdout || ""}\n${stderr || ""}`.toLowerCase();
    if (output.includes("logged in")) {
      return { ok: true };
    }
    return { ok: false, error: "Codex CLI is installed but not logged in. Run `codex login`." };
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { ok: false, error: `Codex CLI is not found. Set CODEX_CLI_PATH (current: ${codexPath}).` };
    }
    const stderr = String(error?.stderr || "").trim();
    const stdout = String(error?.stdout || "").trim();
    return { ok: false, error: stderr || stdout || "Failed to check Codex CLI status" };
  }
}

function buildCodexModelList(env: Record<string, string>): string[] {
  const preferred = String(env.CODEX_MODEL || "").trim();
  return [...new Set([preferred, ...DEFAULT_CODEX_MODELS].filter(Boolean))];
}

function getDefaultCodexModel(env: Record<string, string>): string {
  return buildCodexModelList(env)[0] || "gpt-5.3-codex";
}

function toModelInfo(model: {
  id: string;
  name: string;
  type: string;
  model: string;
  baseUrl?: string;
  roles?: string[];
  capabilities?: string[];
  enabled: boolean;
  agentMode: "manual" | "recruitable" | "autonomous";
  active: boolean;
  runtimeOnly?: boolean;
}): ModelInfo {
  return {
    id: model.id,
    name: model.name,
    type: model.type,
    adapter: model.type,
    model: model.model,
    baseUrl: model.baseUrl,
    roles: model.roles,
    capabilities: model.capabilities,
    enabled: model.enabled,
    agentMode: model.agentMode,
    active: model.active,
    runtimeOnly: model.runtimeOnly
  };
}

function getRuntimeOnlyModels(context: WebServerContext): ModelInfo[] {
  const persistedModels = context.db.getModelConfigs();
  const persistedNames = new Set(persistedModels.map((model) => model.name));
  const runtimeNames = new Set(context.getAvailableAgents().map((agent) => agent.name));
  const env = loadEnvMap();
  const runtimeOnly: ModelInfo[] = [];
  const hasPersistedActive = persistedModels.some((model) => model.active);

  const pushRuntimeModel = (model: ModelInfo): void => {
    if (persistedNames.has(model.name) || !runtimeNames.has(model.name)) {
      return;
    }
    runtimeOnly.push(model);
  };

  pushRuntimeModel({
    id: "runtime:ollama-local",
    name: "ollama-local",
    type: "OllamaAdapter",
    model: String(env.OLLAMA_MODEL || "").trim() || "qwen2.5:14b",
    baseUrl: String(env.OLLAMA_BASE_URL || "").trim() || "http://localhost:11434",
    enabled: true,
    agentMode: "manual",
    active: !hasPersistedActive,
    runtimeOnly: true
  });

  if (String(env.OPENAI_API_KEY || "").trim()) {
    pushRuntimeModel({
      id: "runtime:openai",
      name: "openai",
      type: "OpenAIAdapter",
      model: String(env.OPENAI_MODEL || "").trim() || "gpt-4o-mini",
      baseUrl: String(env.OPENAI_BASE_URL || "").trim() || "https://api.openai.com/v1",
      enabled: true,
      agentMode: "manual",
      active: !hasPersistedActive && runtimeOnly.length === 0,
      runtimeOnly: true
    });
  }

  if (String(env.ANTHROPIC_API_KEY || "").trim()) {
    pushRuntimeModel({
      id: "runtime:claude",
      name: "claude",
      type: "ClaudeAdapter",
      model: String(env.ANTHROPIC_MODEL || "").trim() || "claude-3-7-sonnet-latest",
      baseUrl: String(env.ANTHROPIC_BASE_URL || "").trim() || "https://api.anthropic.com/v1",
      enabled: true,
      agentMode: "manual",
      active: !hasPersistedActive && runtimeOnly.length === 0,
      runtimeOnly: true
    });
  }

  if (String(env.GOOGLE_API_KEY || "").trim()) {
    pushRuntimeModel({
      id: "runtime:google",
      name: "google",
      type: "GoogleAdapter",
      model: String(env.GOOGLE_MODEL || "").trim() || "gemini-2.5-flash",
      baseUrl: String(env.GOOGLE_BASE_URL || "").trim() || "https://generativelanguage.googleapis.com/v1beta",
      enabled: true,
      agentMode: "manual",
      active: !hasPersistedActive && runtimeOnly.length === 0,
      runtimeOnly: true
    });
  }

  if (String(env.CODEX_MODEL || "").trim()) {
    pushRuntimeModel({
      id: "runtime:codex",
      name: "codex",
      type: "CodexAdapter",
      model: String(env.CODEX_MODEL || "").trim(),
      enabled: true,
      agentMode: "manual",
      active: !hasPersistedActive && runtimeOnly.length === 0,
      runtimeOnly: true
    });
  }

  return runtimeOnly;
}

export function modelsRouter(context: WebServerContext) {
  const router = Router();

  // List all models
  router.get("/", (req: Request, res: Response) => {
    try {
      const models = context.db.getModelConfigs();
      const data = [
        ...models.map((model) => toModelInfo(model)),
        ...getRuntimeOnlyModels(context)
      ];
      const response: ApiResponse<ModelInfo[]> = {
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
        data: toModelInfo(model)
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
      const env = loadEnvMap();

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
      } else if (adapter === "GoogleAdapter") {
        if (!apiKey) {
          res.status(400).json({ success: false, error: "API key is required for Google" });
          return;
        }

        try {
          const url = (baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
          const endpoint = `${url}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [{ text: "ping" }]
                }
              ],
              generationConfig: {
                maxOutputTokens: 8,
                temperature: 0
              }
            })
          });

          if (response.ok) {
            res.json({ success: true });
          } else {
            const error = await response.json().catch(() => ({}));
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
      } else if (adapter === "CodexAdapter") {
        const status = await checkCodexCliReady(env);
        if (status.ok) {
          res.json({ success: true });
        } else {
          res.json({
            success: false,
            error: status.error || "Codex CLI is unavailable"
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
      const env = loadEnvMap();

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
      } else if (adapter === "GoogleAdapter") {
        if (!apiKey) {
          res.status(400).json({ success: false, error: "API key is required for Google" });
          return;
        }

        try {
          const url = (baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
          const response = await fetch(`${url}/models?key=${encodeURIComponent(apiKey)}`, {
            method: "GET",
            headers: {
              "Content-Type": "application/json"
            }
          });

          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            res.json({
              success: false,
              error: error.error?.message || `Google API error: ${response.status}`
            });
            return;
          }

          const data: any = await response.json();
          const models = (data.models || [])
            .filter((modelItem: any) =>
              Array.isArray(modelItem.supportedGenerationMethods)
              && modelItem.supportedGenerationMethods.includes("generateContent")
            )
            .map((modelItem: any) => String(modelItem.name || "").replace(/^models\//, ""))
            .filter(Boolean)
            .sort();

          if (models.length === 0) {
            res.json({
              success: false,
              error: "No generation-capable Gemini models returned by Google API"
            });
            return;
          }

          res.json({
            success: true,
            models: models.slice(0, 30)
          });
        } catch (error) {
          res.json({
            success: false,
            error: error instanceof Error ? error.message : "Google API test failed"
          });
        }
      } else if (adapter === "CodexAdapter") {
        const status = await checkCodexCliReady(env);
        res.json({
          success: true,
          models: buildCodexModelList(env),
          message: status.ok ? undefined : (status.error || "Codex CLI is unavailable")
        });
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
      const { type, adapter, name, model, config, baseUrl, apiKey, apiKeyEnv, roles, capabilities, agentMode } = req.body;
      const env = loadEnvMap();
      
      // Extract values from new format if provided
      const adapterType = String(adapter || type || "").trim();
      const adapterTypeLower = adapterType.toLowerCase();
      const inputModelName = String(config?.model || model || "").trim();
      const modelName = inputModelName || (adapterTypeLower === "codexadapter" ? getDefaultCodexModel(env) : "");
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
        agentMode: agentMode === "manual" || agentMode === "autonomous" ? agentMode : "recruitable",
        active: false // Will be set to true if it's the first one
      });

      // If this is the first model of this adapter type, make it active
      const allModels = context.db.getModelConfigs().filter(m => m.type === adapterType);
      if (allModels.length === 1) {
        context.db.setActiveModel(newModel.name, adapterType);
      }
      context.refreshRuntimeAdapters();

      const response: ApiResponse<ModelInfo> = {
        success: true,
        data: {
          id: newModel.id,
          name: newModel.name,
          type: newModel.type,
          adapter: newModel.type,
          model: newModel.model,
          baseUrl: newModel.baseUrl,
          roles: newModel.roles,
          capabilities: newModel.capabilities,
          enabled: newModel.enabled,
          agentMode: newModel.agentMode,
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
      context.refreshRuntimeAdapters();

      const response: ApiResponse<ModelInfo> = {
        success: true,
        data: {
          id: updated.id,
          name: updated.name,
          type: updated.type,
          adapter: updated.type,
          model: updated.model,
          baseUrl: updated.baseUrl,
          roles: updated.roles,
          capabilities: updated.capabilities,
          enabled: updated.enabled,
          agentMode: updated.agentMode,
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
      context.refreshRuntimeAdapters();
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
      context.refreshRuntimeAdapters();

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
