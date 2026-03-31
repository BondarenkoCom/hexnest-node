import { AgentAdapter } from "./adapters/AgentAdapter.js";
import { ClaudeAdapter } from "./adapters/ClaudeAdapter.js";
import { OllamaAdapter } from "./adapters/OllamaAdapter.js";
import { OpenAIAdapter } from "./adapters/OpenAIAdapter.js";

export interface NodeConfig {
  coreUrl: string;
  nodeName: string;
  operatorName: string;
  operatorEmail?: string;
  nodeId?: string;
  nodeToken?: string;
  heartbeatIntervalMs: number;
  invitationPollMs: number;
  autoAcceptInvites: boolean;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NodeConfig {
  const coreUrl = String(env.HEXNEST_CORE_URL || "").trim();
  const nodeName = String(env.HEXNEST_NODE_NAME || "").trim();
  const operatorName = String(env.HEXNEST_OPERATOR_NAME || "").trim();
  if (!coreUrl) throw new Error("HEXNEST_CORE_URL is required");
  if (!nodeName) throw new Error("HEXNEST_NODE_NAME is required");
  if (!operatorName) throw new Error("HEXNEST_OPERATOR_NAME is required");

  return {
    coreUrl,
    nodeName,
    operatorName,
    operatorEmail: String(env.HEXNEST_OPERATOR_EMAIL || "").trim() || undefined,
    nodeId: String(env.HEXNEST_NODE_ID || "").trim() || undefined,
    nodeToken: String(env.HEXNEST_NODE_TOKEN || "").trim() || undefined,
    heartbeatIntervalMs: parseNumber(env.HEXNEST_HEARTBEAT_INTERVAL_MS, 60_000),
    invitationPollMs: parseNumber(env.HEXNEST_INVITATION_POLL_MS, 30_000),
    autoAcceptInvites: parseBoolean(env.HEXNEST_AUTO_ACCEPT_INVITES, true)
  };
}

export function buildAdapters(env: NodeJS.ProcessEnv = process.env): AgentAdapter[] {
  const adapters: AgentAdapter[] = [];

  adapters.push(
    new OllamaAdapter({
      model: String(env.OLLAMA_MODEL || "qwen2.5:14b"),
      baseUrl: String(env.OLLAMA_BASE_URL || "http://localhost:11434")
    })
  );

  const openAiKey = String(env.OPENAI_API_KEY || "").trim();
  if (openAiKey) {
    adapters.push(
      new OpenAIAdapter(openAiKey, {
        model: String(env.OPENAI_MODEL || "gpt-5-mini")
      })
    );
  }

  const anthropicKey = String(env.ANTHROPIC_API_KEY || "").trim();
  if (anthropicKey) {
    adapters.push(
      new ClaudeAdapter(anthropicKey, {
        model: String(env.ANTHROPIC_MODEL || "claude-3-7-sonnet-latest")
      })
    );
  }

  return adapters;
}
