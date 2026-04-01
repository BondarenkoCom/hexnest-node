import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { parse as parseYaml } from "yaml";
import { AgentAdapter } from "./adapters/AgentAdapter.js";
import { ClaudeAdapter } from "./adapters/ClaudeAdapter.js";
import { OllamaAdapter } from "./adapters/OllamaAdapter.js";
import { OpenAIAdapter } from "./adapters/OpenAIAdapter.js";

export interface NodeConfig {
  coreUrl: string;
  nodeName: string;
  operatorName: string;
  operatorEmail?: string;
  callbackUrl?: string;
  nodeId?: string;
  nodeToken?: string;
  identityPath?: string;
  heartbeatIntervalMs: number;
  approvalPollIntervalMs: number;
  usageFlushIntervalMs: number;
  maxUsageBatch: number;
  shutdownGraceMs: number;
  autoAcceptInvites: boolean;
  httpTimeoutMs: number;
}

interface YamlNodeConfig {
  node?: {
    name?: string;
    operatorName?: string;
    operatorEmail?: string;
    callbackUrl?: string;
    autoAcceptInvites?: boolean;
  };
  core?: {
    url?: string;
    heartbeatIntervalMs?: number;
    usageFlushIntervalMs?: number;
    maxUsageBatch?: number;
    shutdownGraceMs?: number;
    httpTimeoutMs?: number;
  };
  adapters?: AdapterConfigSource[];
}

interface AdapterConfigSource {
  type?: string;
  name?: string;
  model?: string;
  baseUrl?: string;
  capabilities?: string[];
  roles?: string[];
  supportedRoles?: string[];
  apiKeyEnv?: string;
  apiKey?: string;
}

export interface RuntimeSetup {
  config: NodeConfig;
  adapters: AgentAdapter[];
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value == null || String(value).trim() === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "n") return false;
  return fallback;
}

function parseNumber(value: unknown, fallback: number, min = 1): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return fallback;
  return Math.round(parsed);
}

function str(value: unknown): string | undefined {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function resolveOptionalPath(rawPath: string | undefined): string | null {
  const input = str(rawPath);
  if (!input) return null;
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

function loadEnvMap(baseEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const envMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string") envMap[key] = value;
  }

  const explicitEnvFile = resolveOptionalPath(envMap.HEXNEST_ENV_FILE);
  const defaultEnvFile = path.resolve(process.cwd(), ".env");
  const envPath = explicitEnvFile || (fs.existsSync(defaultEnvFile) ? defaultEnvFile : null);
  if (!envPath || !fs.existsSync(envPath)) {
    return envMap;
  }

  const parsed = dotenv.parse(fs.readFileSync(envPath));
  for (const [key, value] of Object.entries(parsed)) {
    if (envMap[key] === undefined) {
      envMap[key] = value;
    }
  }
  return envMap;
}

function loadYamlConfig(env: Record<string, string>): YamlNodeConfig {
  const explicitPath = resolveOptionalPath(env.HEXNEST_CONFIG_PATH);
  const defaultPath = path.resolve(process.cwd(), "node-config.yaml");
  const yamlPath = explicitPath || (fs.existsSync(defaultPath) ? defaultPath : null);
  if (!yamlPath || !fs.existsSync(yamlPath)) {
    return {};
  }

  const content = fs.readFileSync(yamlPath, "utf8");
  const parsed = parseYaml(content);
  if (!parsed || typeof parsed !== "object") return {};
  return parsed as YamlNodeConfig;
}

function loadIdentity(pathname: string | null): { nodeId?: string; nodeToken?: string } {
  if (!pathname || !fs.existsSync(pathname)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(pathname, "utf8");
    const parsed = JSON.parse(raw) as { nodeId?: unknown; nodeToken?: unknown };
    const nodeId = str(parsed.nodeId);
    const nodeToken = str(parsed.nodeToken);
    return {
      nodeId: nodeId || undefined,
      nodeToken: nodeToken || undefined
    };
  } catch {
    return {};
  }
}

function adapterFromSource(source: AdapterConfigSource, env: Record<string, string>): AgentAdapter | null {
  const type = str(source.type)?.toLowerCase();
  const name = str(source.name);
  const model = str(source.model);
  const baseUrl = str(source.baseUrl);
  const capabilities = stringArray(source.capabilities);
  const supportedRoles = stringArray(source.supportedRoles).length
    ? stringArray(source.supportedRoles)
    : stringArray(source.roles);

  if (type === "ollama") {
    return new OllamaAdapter({
      name,
      model: model || "qwen2.5:14b",
      baseUrl: baseUrl || "http://localhost:11434",
      capabilities: capabilities.length ? capabilities : undefined,
      supportedRoles: supportedRoles.length ? supportedRoles : undefined
    });
  }

  if (type === "openai") {
    const keyVar = str(source.apiKeyEnv) || "OPENAI_API_KEY";
    const apiKey = str(source.apiKey) || str(env[keyVar]);
    if (!apiKey) return null;
    return new OpenAIAdapter(apiKey, {
      name,
      model: model || str(env.OPENAI_MODEL) || "gpt-4o-mini",
      baseUrl,
      capabilities: capabilities.length ? capabilities : undefined,
      supportedRoles: supportedRoles.length ? supportedRoles : undefined
    });
  }

  if (type === "claude" || type === "anthropic") {
    const keyVar = str(source.apiKeyEnv) || "ANTHROPIC_API_KEY";
    const apiKey = str(source.apiKey) || str(env[keyVar]);
    if (!apiKey) return null;
    return new ClaudeAdapter(apiKey, {
      name,
      model: model || str(env.ANTHROPIC_MODEL) || "claude-3-7-sonnet-latest",
      baseUrl,
      capabilities: capabilities.length ? capabilities : undefined,
      supportedRoles: supportedRoles.length ? supportedRoles : undefined
    });
  }

  return null;
}

function registerAdapter(
  adaptersByName: Map<string, AgentAdapter>,
  adapter: AgentAdapter | null
): void {
  if (!adapter) return;
  adaptersByName.set(adapter.name, adapter);
}

export function loadConfig(baseEnv: NodeJS.ProcessEnv = process.env): NodeConfig {
  const env = loadEnvMap(baseEnv);
  const yaml = loadYamlConfig(env);
  const identityPath = resolveOptionalPath(env.HEXNEST_IDENTITY_PATH || ".hexnest-identity.json");
  const identity = loadIdentity(identityPath);

  const coreUrl = str(env.HEXNEST_CORE_URL) || str(yaml.core?.url);
  const nodeName = str(env.HEXNEST_NODE_NAME) || str(yaml.node?.name);
  const operatorName = str(env.HEXNEST_OPERATOR_NAME) || str(yaml.node?.operatorName);
  if (!coreUrl) throw new Error("HEXNEST_CORE_URL is required");
  if (!nodeName) throw new Error("HEXNEST_NODE_NAME is required");
  if (!operatorName) throw new Error("HEXNEST_OPERATOR_NAME is required");

  return {
    coreUrl,
    nodeName,
    operatorName,
    operatorEmail: str(env.HEXNEST_OPERATOR_EMAIL) || str(yaml.node?.operatorEmail),
    callbackUrl: str(env.HEXNEST_CALLBACK_URL) || str(yaml.node?.callbackUrl),
    nodeId: str(env.HEXNEST_NODE_ID) || identity.nodeId,
    nodeToken: str(env.HEXNEST_NODE_TOKEN) || identity.nodeToken,
    identityPath: identityPath || undefined,
    heartbeatIntervalMs: parseNumber(
      env.HEXNEST_HEARTBEAT_INTERVAL_MS ?? yaml.core?.heartbeatIntervalMs,
      60_000
    ),
    approvalPollIntervalMs: parseNumber(env.HEXNEST_APPROVAL_POLL_INTERVAL_MS, 15_000),
    usageFlushIntervalMs: parseNumber(
      env.HEXNEST_USAGE_FLUSH_INTERVAL_MS ?? yaml.core?.usageFlushIntervalMs,
      90_000
    ),
    maxUsageBatch: parseNumber(
      env.HEXNEST_USAGE_MAX_BATCH ?? yaml.core?.maxUsageBatch,
      100
    ),
    shutdownGraceMs: parseNumber(
      env.HEXNEST_SHUTDOWN_GRACE_MS ?? yaml.core?.shutdownGraceMs,
      30_000
    ),
    autoAcceptInvites: parseBoolean(
      env.HEXNEST_AUTO_ACCEPT_INVITES ?? yaml.node?.autoAcceptInvites,
      true
    ),
    httpTimeoutMs: parseNumber(
      env.HEXNEST_HTTP_TIMEOUT_MS ?? yaml.core?.httpTimeoutMs,
      20_000
    )
  };
}

export function buildAdapters(baseEnv: NodeJS.ProcessEnv = process.env): AgentAdapter[] {
  const env = loadEnvMap(baseEnv);
  const yaml = loadYamlConfig(env);
  const adaptersByName = new Map<string, AgentAdapter>();

  for (const source of yaml.adapters || []) {
    registerAdapter(adaptersByName, adapterFromSource(source, env));
  }

  registerAdapter(
    adaptersByName,
    new OllamaAdapter({
      model: str(env.OLLAMA_MODEL) || "qwen2.5:14b",
      baseUrl: str(env.OLLAMA_BASE_URL) || "http://localhost:11434"
    })
  );

  const openAiKey = str(env.OPENAI_API_KEY);
  if (openAiKey) {
    registerAdapter(
      adaptersByName,
      new OpenAIAdapter(openAiKey, {
        model: str(env.OPENAI_MODEL) || "gpt-4o-mini"
      })
    );
  }

  const anthropicKey = str(env.ANTHROPIC_API_KEY);
  if (anthropicKey) {
    registerAdapter(
      adaptersByName,
      new ClaudeAdapter(anthropicKey, {
        model: str(env.ANTHROPIC_MODEL) || "claude-3-7-sonnet-latest"
      })
    );
  }

  return [...adaptersByName.values()];
}

export function loadRuntimeSetup(baseEnv: NodeJS.ProcessEnv = process.env): RuntimeSetup {
  const config = loadConfig(baseEnv);
  const adapters = buildAdapters(baseEnv);
  return { config, adapters };
}
