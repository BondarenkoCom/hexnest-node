import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CORE_URL = "https://hex-nest.com";
const DEFAULT_OLLAMA_MODEL = "qwen2.5:14b";
const IDENTITY_FILENAME = ".hexnest-identity.json";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt?: string;
}

interface AuthResponse {
  userId: string;
  token: string;
  expiresAt?: string | null;
  user: AuthUser;
}

interface NodeRegisterResponse {
  nodeId: string;
  nodeToken: string;
  status: "pending" | "approved" | "suspended" | "rejected";
}

interface IdentityFile {
  nodeId: string;
  nodeToken: string;
  nodeName?: string;
  coreUrl?: string;
  updatedAt: string;
}

interface AdapterSpec {
  provider: string;
  model?: string;
}

function normalizeBaseUrl(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return DEFAULT_CORE_URL;
  return value.replace(/\/+$/, "");
}

function normalizeEmail(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

function parseYes(value: string): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

function parseAdapters(raw: string): AdapterSpec[] {
  const fallback = [{ provider: "ollama", model: DEFAULT_OLLAMA_MODEL }];
  const value = String(raw || "").trim();
  if (!value) return fallback;

  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return fallback;

  const parsed: AdapterSpec[] = [];
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (normalized.startsWith("ollama")) {
      const modelMatch = part.match(/\(([^)]+)\)/);
      const modelFromColon = part.includes(":") ? part.slice(part.indexOf(":") + 1).trim() : "";
      const model = (modelMatch?.[1] || modelFromColon || DEFAULT_OLLAMA_MODEL).trim();
      parsed.push({ provider: "ollama", model: model || DEFAULT_OLLAMA_MODEL });
      continue;
    }
    if (normalized.startsWith("openai")) {
      parsed.push({ provider: "openai" });
      continue;
    }
    if (normalized.startsWith("claude") || normalized.startsWith("anthropic")) {
      parsed.push({ provider: "claude" });
      continue;
    }
    if (normalized.startsWith("codex")) {
      parsed.push({ provider: "codex" });
      continue;
    }
  }

  return parsed.length > 0 ? parsed : fallback;
}

function capabilitiesFromAdapters(adapters: AdapterSpec[]): string[] {
  const capabilities = new Set<string>(["general"]);
  for (const adapter of adapters) {
    if (adapter.provider === "ollama") capabilities.add("local");
    if (adapter.provider === "openai") capabilities.add("reasoning");
    if (adapter.provider === "claude") capabilities.add("analysis");
    if (adapter.provider === "codex") capabilities.add("coding");
  }
  return [...capabilities];
}

async function requestJson<T>(
  url: string,
  options: { method?: string; token?: string; body?: unknown }
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    const errorText = String(payload.error || `${response.status} ${response.statusText}`).trim();
    throw new Error(errorText);
  }

  return payload as T;
}

async function registerOrLogin(
  coreUrl: string,
  mode: "register" | "login",
  email: string,
  password: string,
  name?: string
): Promise<AuthResponse> {
  const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
  const body: Record<string, unknown> = { email, password };
  if (mode === "register") {
    body.name = name;
  }
  return requestJson<AuthResponse>(`${coreUrl}${endpoint}`, {
    method: "POST",
    body
  });
}

async function registerNode(
  coreUrl: string,
  authToken: string,
  payload: {
    name: string;
    operatorName: string;
    operatorEmail: string;
    agentCapabilities: string[];
  }
): Promise<NodeRegisterResponse> {
  return requestJson<NodeRegisterResponse>(`${coreUrl}/api/nodes/register`, {
    method: "POST",
    token: authToken,
    body: payload
  });
}

async function loadIdentity(identityPath: string): Promise<IdentityFile | null> {
  if (!fs.existsSync(identityPath)) return null;
  try {
    const raw = await readFile(identityPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<IdentityFile>;
    const nodeId = String(parsed.nodeId || "").trim();
    const nodeToken = String(parsed.nodeToken || "").trim();
    if (!nodeId || !nodeToken) return null;
    return {
      nodeId,
      nodeToken,
      nodeName: String(parsed.nodeName || "").trim() || undefined,
      coreUrl: String(parsed.coreUrl || "").trim() || undefined,
      updatedAt: String(parsed.updatedAt || "").trim() || new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function buildEnvContent(input: {
  coreUrl: string;
  nodeName: string;
  operatorName: string;
  operatorEmail: string;
  ollamaModel: string;
}): string {
  return [
    `HEXNEST_CORE_URL=${input.coreUrl}`,
    `HEXNEST_NODE_NAME=${input.nodeName}`,
    `HEXNEST_OPERATOR_NAME=${input.operatorName}`,
    `HEXNEST_OPERATOR_EMAIL=${input.operatorEmail}`,
    "HEXNEST_CALLBACK_URL=",
    "HEXNEST_NODE_ID=",
    "HEXNEST_NODE_TOKEN=",
    `HEXNEST_IDENTITY_PATH=${IDENTITY_FILENAME}`,
    "HEXNEST_HEARTBEAT_INTERVAL_MS=60000",
    "HEXNEST_USAGE_FLUSH_INTERVAL_MS=90000",
    "HEXNEST_USAGE_MAX_BATCH=100",
    "HEXNEST_SHUTDOWN_GRACE_MS=30000",
    "HEXNEST_HTTP_TIMEOUT_MS=20000",
    "HEXNEST_AUTO_ACCEPT_INVITES=true",
    "",
    "OLLAMA_BASE_URL=http://localhost:11434",
    `OLLAMA_MODEL=${input.ollamaModel || DEFAULT_OLLAMA_MODEL}`,
    "",
    "OPENAI_API_KEY=",
    "OPENAI_MODEL=gpt-5-mini",
    "",
    "ANTHROPIC_API_KEY=",
    "ANTHROPIC_MODEL=claude-3-7-sonnet-latest",
    "",
    "# Codex CLI adapter (uses local codex login)",
    "CODEX_MODEL=gpt-5.4",
    "CODEX_TIMEOUT_MS=120000",
    "CODEX_CLI_PATH=codex",
    ""
  ].join("\n");
}

async function run(): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    console.log("\n  HexNest Node Setup\n");

    const coreUrlRaw = await rl.question(`  Core URL [${DEFAULT_CORE_URL}]: `);
    const coreUrl = normalizeBaseUrl(coreUrlRaw || DEFAULT_CORE_URL);
    const hasAccountRaw = await rl.question("  Do you have an account? (y/n): ");
    const hasAccount = parseYes(hasAccountRaw);

    const email = normalizeEmail(await rl.question("  Email: "));
    const password = String(await rl.question("  Password: ")).trim();
    if (!email || !password) {
      throw new Error("Email and password are required");
    }

    let auth: AuthResponse;
    if (hasAccount) {
      auth = await registerOrLogin(coreUrl, "login", email, password);
      console.log("\n  [ok] Logged in");
    } else {
      const accountName = String(await rl.question("  Name: ")).trim();
      if (!accountName) {
        throw new Error("Name is required for account creation");
      }
      auth = await registerOrLogin(coreUrl, "register", email, password, accountName);
      console.log("\n  [ok] Account created");
    }

    const identityPath = path.resolve(process.cwd(), IDENTITY_FILENAME);
    const existingIdentity = await loadIdentity(identityPath);
    let chosenIdentity = existingIdentity;
    if (existingIdentity) {
      const reuseRaw = await rl.question(
        `  Existing identity found (${existingIdentity.nodeId}). Reuse it? (y/n): `
      );
      if (!parseYes(reuseRaw)) {
        chosenIdentity = null;
      }
    }

    let nodeName = String(existingIdentity?.nodeName || "").trim();
    let adapters = parseAdapters("");
    if (!chosenIdentity) {
      const nodeNameRaw = await rl.question("  Node name: ");
      nodeName = String(nodeNameRaw || "").trim();
      if (!nodeName) {
        throw new Error("Node name is required");
      }
      const adaptersRaw = await rl.question(`  Adapters [ollama (${DEFAULT_OLLAMA_MODEL})]: `);
      adapters = parseAdapters(adaptersRaw);
      const capabilities = capabilitiesFromAdapters(adapters);

      const nodeRegistration = await registerNode(coreUrl, auth.token, {
        name: nodeName,
        operatorName: auth.user.name,
        operatorEmail: auth.user.email,
        agentCapabilities: capabilities
      });

      chosenIdentity = {
        nodeId: nodeRegistration.nodeId,
        nodeToken: nodeRegistration.nodeToken,
        nodeName,
        coreUrl,
        updatedAt: new Date().toISOString()
      };

      await writeFile(identityPath, JSON.stringify(chosenIdentity, null, 2), "utf8");
      console.log("\n  [ok] Node registered (pending approval)");
      console.log(`  [ok] Credentials saved to ${IDENTITY_FILENAME}`);
    } else {
      if (!nodeName) {
        nodeName = String(await rl.question("  Node name: ")).trim();
      }
      console.log("\n  [ok] Reusing existing node identity");
    }

    const ollamaAdapter = adapters.find((item) => item.provider === "ollama");
    const envContent = buildEnvContent({
      coreUrl,
      nodeName: nodeName || "hexnest-node",
      operatorName: auth.user.name,
      operatorEmail: auth.user.email,
      ollamaModel: ollamaAdapter?.model || DEFAULT_OLLAMA_MODEL
    });
    const envPath = path.resolve(process.cwd(), ".env");
    await writeFile(envPath, envContent, "utf8");
    console.log(`  [ok] Updated .env (${envPath})`);
    console.log("\n  Run: npx hexnest-node start\n");
  } finally {
    rl.close();
  }
}

run().catch((error) => {
  console.error("[setup] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
