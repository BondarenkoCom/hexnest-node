import fs from "node:fs/promises";
import path from "node:path";
import { resolveRuntimePath } from "../runtime-paths.js";

type PromptPayload =
  | { format: "single"; text: string }
  | { format: "system-user"; system: string; user: string };

interface ModelTraceRecord {
  service: "hexnest-node";
  adapter: string;
  model: string;
  transport: "cli" | "discussion" | "local";
  roomId: string;
  role: string;
  phase: string;
  prompt: PromptPayload;
  response?: string;
  error?: {
    message: string;
    stack?: string;
  };
}

const DEFAULT_TRACE_MAX_CHARS = 20_000;
const DEFAULT_TRACE_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TRACE_MAX_FILES = 3;

function isTraceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.HEXNEST_MODEL_TRACE_ENABLED || "1").trim() !== "0";
}

function resolveTraceFile(env: NodeJS.ProcessEnv = process.env): string {
  const configured = String(env.HEXNEST_MODEL_TRACE_FILE || "").trim();
  return resolveRuntimePath(configured || "hexnest-model-trace.jsonl", env);
}

function resolveTraceMaxChars(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.HEXNEST_MODEL_TRACE_MAX_CHARS);
  return Number.isFinite(value) && value > 0 ? Math.max(256, Math.floor(value)) : DEFAULT_TRACE_MAX_CHARS;
}

function resolveTraceMaxFileBytes(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.HEXNEST_MODEL_TRACE_MAX_FILE_BYTES);
  return Number.isFinite(value) && value > 0 ? Math.max(1024, Math.floor(value)) : DEFAULT_TRACE_MAX_FILE_BYTES;
}

function resolveTraceMaxFiles(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.HEXNEST_MODEL_TRACE_MAX_FILES);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : DEFAULT_TRACE_MAX_FILES;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...<truncated>...`;
}

function normalizePrompt(prompt: PromptPayload, maxChars: number): PromptPayload {
  if (prompt.format === "single") {
    return {
      format: "single",
      text: truncateText(prompt.text, maxChars)
    };
  }
  return {
    format: "system-user",
    system: truncateText(prompt.system, maxChars),
    user: truncateText(prompt.user, maxChars)
  };
}

async function rotateTraceFile(filePath: string, maxFiles: number): Promise<void> {
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`;
    const target = `${filePath}.${index + 1}`;
    await fs.rm(target, { force: true }).catch(() => undefined);
    await fs.rename(source, target).catch(() => undefined);
  }
  await fs.rm(`${filePath}.1`, { force: true }).catch(() => undefined);
  await fs.rename(filePath, `${filePath}.1`).catch(() => undefined);
}

async function ensureTraceCapacity(filePath: string, incomingBytes: number, env: NodeJS.ProcessEnv): Promise<void> {
  const maxBytes = resolveTraceMaxFileBytes(env);
  const maxFiles = resolveTraceMaxFiles(env);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) {
    return;
  }
  if (stat.size + incomingBytes <= maxBytes) {
    return;
  }
  await rotateTraceFile(filePath, maxFiles);
}

function serializeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {})
    };
  }
  return { message: String(error) };
}

async function appendRecord(record: ModelTraceRecord): Promise<void> {
  if (!isTraceEnabled()) {
    return;
  }

  const maxChars = resolveTraceMaxChars();
  const normalizedRecord: ModelTraceRecord = {
    ...record,
    prompt: normalizePrompt(record.prompt, maxChars),
    ...(typeof record.response === "string"
      ? { response: truncateText(record.response, maxChars) }
      : {}),
    ...(record.error
      ? {
          error: {
            message: truncateText(record.error.message, maxChars),
            ...(record.error.stack ? { stack: truncateText(record.error.stack, maxChars) } : {})
          }
        }
      : {})
  };

  const filePath = resolveTraceFile();
  const line = `${JSON.stringify({ timestamp: new Date().toISOString(), ...normalizedRecord })}\n`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await ensureTraceCapacity(filePath, Buffer.byteLength(line, "utf8"), process.env);
  await fs.appendFile(filePath, line, "utf8");
}

export function traceNodeModelSuccess(record: Omit<ModelTraceRecord, "service">): void {
  void appendRecord({ service: "hexnest-node", ...record }).catch(() => undefined);
}

export function traceNodeModelError(
  record: Omit<ModelTraceRecord, "service" | "error">,
  error: unknown
): void {
  void appendRecord({
    service: "hexnest-node",
    ...record,
    error: serializeError(error)
  }).catch(() => undefined);
}