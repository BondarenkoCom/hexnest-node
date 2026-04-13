import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { parse as parseYaml } from "yaml";
import { randomUUID } from "node:crypto";
import { AgentAdapter } from "./adapters/AgentAdapter.js";
import { ClaudeAdapter } from "./adapters/ClaudeAdapter.js";
import { OllamaAdapter } from "./adapters/OllamaAdapter.js";
import { GrokAdapter } from "./adapters/GrokAdapter.js";
import { OpenAIAdapter } from "./adapters/OpenAIAdapter.js";
import { DatabaseService } from "./db/database.js";
import type { ModelConfig } from "./db/database.js";
import {
  resolveDefaultEnvFile,
  resolveDefaultYamlConfigPath,
  resolveRuntimePath
} from "./runtime-paths.js";

export interface NodeConfig {
  coreUrl: string;
  nodeName: string;
  operatorName: string;
  operatorEmail?: string;
  callbackUrl?: string;
  nodeId?: string;
  nodeToken?: string;
  identityPath?: string;
  userEmail?: string;
  userToken?: string;
  heartbeatIntervalMs: number;
  approvalPollIntervalMs: number;
  usageFlushIntervalMs: number;
  maxUsageBatch: number;
  shutdownGraceMs: number;
  autoAcceptInvites: boolean;
  httpTimeoutMs: number;
  manualRegistrationOnly?: boolean;
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
  database: DatabaseService;
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

function normalizeAdapterKind(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "ollama" || normalized === "ollamaadapter") {
    return "ollama";
  }
  if (normalized === "openai" || normalized === "openaiadapter") {
    return "openai";
  }
  if (normalized === "claude" || normalized === "claudeadapter" || normalized === "anthropic") {
    return "claude";
  }
  if (normalized === "grok" || normalized === "grokadapter" || normalized === "xai") {
    return "grok";
  }
  return normalized;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function resolveOptionalPath(rawPath: string | undefined): string | null {
  const input = str(rawPath);
  if (!input) return null;
  return resolveRuntimePath(input);
}

export function loadEnvMap(baseEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const envMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string") envMap[key] = value;
  }

  const envPath = resolveDefaultEnvFile(baseEnv);
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
  const yamlPath = resolveDefaultYamlConfigPath(env);
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

function migrateIdentityToDatabase(db: DatabaseService, identityPath: string | null): void {
  if (!db.isReady()) {
    return;
  }
  const identity = loadIdentity(identityPath);
  if (identity.nodeId && identity.nodeToken) {
    const existing = db.getNodeIdentity();
    if (!existing) {
      db.setNodeIdentity(identity.nodeId, identity.nodeToken);
    }
  }
}

function adapterFromSource(source: AdapterConfigSource, env: Record<string, string>): AgentAdapter | null {
  const type = normalizeAdapterKind(str(source.type));
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
      baseUrl: baseUrl || "http://127.0.0.1:11434",
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

  if (type === "grok" || type === "xai") {
    const keyVar = str(source.apiKeyEnv) || "GROK_API_KEY";
    const apiKey = str(source.apiKey) || str(env[keyVar]);
    if (!apiKey) return null;
    return new GrokAdapter(apiKey, {
      name,
      model: model || str(env.GROK_MODEL) || "grok-4-1-fast",
      baseUrl,
      capabilities: capabilities.length ? capabilities : undefined,
      supportedRoles: supportedRoles.length ? supportedRoles : undefined
    });
  }

  return null;
}

function adapterFromModelConfig(config: ModelConfig, env: Record<string, string>, db?: DatabaseService): AgentAdapter | null {
  const type = normalizeAdapterKind(config.type);
  const name = config.name;
  const model = config.model;
  const capabilities = config.capabilities || [];
  const supportedRoles = config.roles || [];

  // Fallback chain for baseUrl: Model Config -> Adapter Config -> Default
  let baseUrl = config.baseUrl;
  if (!baseUrl && db) {
    // Try exact match, then case-insensitive lookup, then with "Adapter" suffix
    let globalAdapter = db.getAdapterConfig(type);
    if (!globalAdapter) {
      // Fallback: look for "OllamaAdapter" style if searching for "ollama"
      const allConfigs = db.getAdapterConfigs?.() || []; 
      globalAdapter = allConfigs.find(c => 
        c.type.toLowerCase() === type.toLowerCase() || 
        c.type.toLowerCase() === `${type.toLowerCase()}adapter`
      ) || null;
    }
    
    if (globalAdapter?.baseUrl) {
      baseUrl = globalAdapter.baseUrl;
    }
  }

  if (type === "ollama") {
    return new OllamaAdapter({
      name,
      model: model || "qwen2.5:14b",
      baseUrl: baseUrl || "http://127.0.0.1:11434",
      capabilities: capabilities.length ? capabilities : undefined,
      supportedRoles: supportedRoles.length ? supportedRoles : undefined
    });
  }

  if (type === "openai") {
    const keyVar = config.apiKeyEnv || "OPENAI_API_KEY";
    const apiKey = config.apiKey || str(env[keyVar]);
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
    const keyVar = config.apiKeyEnv || "ANTHROPIC_API_KEY";
    const apiKey = config.apiKey || str(env[keyVar]);
    if (!apiKey) return null;
    return new ClaudeAdapter(apiKey, {
      name,
      model: model || str(env.ANTHROPIC_MODEL) || "claude-3-7-sonnet-latest",
      baseUrl,
      capabilities: capabilities.length ? capabilities : undefined,
      supportedRoles: supportedRoles.length ? supportedRoles : undefined
    });
  }

  if (type === "grok" || type === "xai") {
    const keyVar = config.apiKeyEnv || "GROK_API_KEY";
    const apiKey = config.apiKey || str(env[keyVar]);
    if (!apiKey) return null;
    return new GrokAdapter(apiKey, {
      name,
      model: model || str(env.GROK_MODEL) || "grok-4-1-fast",
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

export function loadConfig(db: DatabaseService, baseEnv: NodeJS.ProcessEnv = process.env): NodeConfig {
  const env = loadEnvMap(baseEnv);
  const yaml = loadYamlConfig(env);
  const identityPath = resolveOptionalPath(env.HEXNEST_IDENTITY_PATH || ".hexnest-identity.json");
  
  // Migrate legacy identity file to database
  migrateIdentityToDatabase(db, identityPath);

  // Try to get identity from database first, fallback to env/yaml
  const dbIdentity = db.getNodeIdentity();
  const nodeIdDb = dbIdentity?.id;
  const nodeTokenDb = dbIdentity?.token;

  const userEmailDb = db.getNodeConfig("user_email");
  const userTokenDb = db.getNodeConfig("user_token");
  const coreUrlDb = db.getNodeConfig("core_url");

  const coreUrl = coreUrlDb || str(env.HEXNEST_CORE_URL) || str(yaml.core?.url);
  if (!coreUrl) throw new Error("Core URL is required via settings, environment, or yaml config");

  // Try to load node name and operator name from database first
  // If not in database, fallback to env/yaml
  // If not specified anywhere, use defaults (for first-run)
  const nodeNameDb = db.getNodeConfig("node_name");
  const operatorNameDb = db.getNodeConfig("operator_name");

  const nodeName = nodeNameDb || str(env.HEXNEST_NODE_NAME) || str(yaml.node?.name) || "node-default";
  const operatorName = operatorNameDb || str(env.HEXNEST_OPERATOR_NAME) || str(yaml.node?.operatorName) || "Operator";

  return {
    coreUrl,
    nodeName,
    operatorName,
    operatorEmail: str(env.HEXNEST_OPERATOR_EMAIL) || str(yaml.node?.operatorEmail),
    callbackUrl: str(env.HEXNEST_CALLBACK_URL) || str(yaml.node?.callbackUrl),
    nodeId: str(env.HEXNEST_NODE_ID) || nodeIdDb,
    nodeToken: str(env.HEXNEST_NODE_TOKEN) || nodeTokenDb,
    identityPath: identityPath || undefined,
    userEmail: userEmailDb || str(env.HEXNEST_USER_EMAIL),
    userToken: userTokenDb || str(env.HEXNEST_USER_TOKEN),
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

export function buildAdapters(db: DatabaseService, baseEnv: NodeJS.ProcessEnv = process.env): AgentAdapter[] {
  const env = loadEnvMap(baseEnv);
  const yaml = loadYamlConfig(env);
  const adaptersByName = new Map<string, AgentAdapter>();
  const dbReady = db.isReady();

  // First, migrate YAML adapters to database if not already there
  if (dbReady) {
    for (const source of yaml.adapters || []) {
      const name = str(source.name);
      if (name && !db.getModelConfig(name)) {
        const id = randomUUID();
        const type = str(source.type)?.toLowerCase() || "ollama";
        db.addModelConfig({
          id,
          type,
          name,
          model: str(source.model) || "",
          baseUrl: str(source.baseUrl),
          apiKey: str(source.apiKey),
          apiKeyEnv: str(source.apiKeyEnv),
          roles: source.roles,
          capabilities: source.capabilities,
          enabled: true,
          agentMode: "recruitable",
          active: true
        });
      }
    }

    // Load all adapters from database
    const dbAdapters = db.getModelConfigs();
    for (const dbAdapter of dbAdapters) {
      if (!dbAdapter.enabled) {
        continue;
      }
      const adapter = adapterFromModelConfig(dbAdapter, env, db);
      if (adapter) {
        adaptersByName.set(adapter.name, adapter);
      }
    }
  } else {
    for (const source of yaml.adapters || []) {
      registerAdapter(adaptersByName, adapterFromSource(source, env));
    }
  }



  return [...adaptersByName.values()];
}

export function loadRuntimeSetup(baseEnv: NodeJS.ProcessEnv = process.env): RuntimeSetup {
  const dbPath = resolveRuntimePath(str(baseEnv.HEXNEST_DB_PATH) || ".hexnest.db", baseEnv);
  const database = new DatabaseService(dbPath);
  const config = loadConfig(database, baseEnv);
  const adapters = buildAdapters(database, baseEnv);
  return { config, adapters, database };
}

export async function loadRuntimeSetupAsync(baseEnv: NodeJS.ProcessEnv = process.env): Promise<RuntimeSetup> {
  const dbPath = resolveRuntimePath(str(baseEnv.HEXNEST_DB_PATH) || ".hexnest.db", baseEnv);
  const database = new DatabaseService(dbPath);
  await database.ensureReady();
  const config = loadConfig(database, baseEnv);
  const adapters = buildAdapters(database, baseEnv);
  return { config, adapters, database };
}
