import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgentAdapter,
  AgentResponse,
  estimateTokensFromText,
  estimateUsdFromModel,
  inferConfidence
} from "./AgentAdapter.js";
import { CostEstimate, RoomContext } from "../protocol/types.js";

interface CodexRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export class CodexAdapter implements AgentAdapter {
  public readonly name: string;
  public readonly modelId: string;
  public readonly capabilities: string[];
  public readonly supportedRoles: string[];

  constructor(
    options: {
      name?: string;
      model?: string;
      capabilities?: string[];
      supportedRoles?: string[];
      timeoutMs?: number;
      codexPath?: string;
    } = {}
  ) {
    this.name = options.name || "codex";
    this.model = String(options.model || process.env.CODEX_MODEL || "").trim();
    this.modelId = this.model || "codex-cli";
    this.capabilities = options.capabilities || ["general", "reasoning", "coding", "research"];
    this.supportedRoles = options.supportedRoles || ["builder", "researcher", "skeptic", "synthesizer", "judge"];
    this.timeoutMs = Math.max(1_000, Number(options.timeoutMs ?? process.env.CODEX_TIMEOUT_MS ?? 120_000));
    this.codexPath = String(options.codexPath || process.env.CODEX_CLI_PATH || "codex").trim() || "codex";
  }

  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly codexPath: string;

  async respond(context: RoomContext): Promise<AgentResponse> {
    const timeline = context.timeline
      .slice(-10)
      .map((event) => {
        const meta = [event.scope, event.type, event.intent].filter(Boolean).join("/");
        const trigger = event.triggeredBy ? ` trig=${event.triggeredBy}` : "";
        return `${event.from} -> ${event.to} [${meta || "chat"}]${trigger}: ${event.text}`;
      })
      .join("\n");
    const actionable = (context.actionableEvents || [])
      .map((event) => {
        const meta = [event.scope, event.type, event.intent].filter(Boolean).join("/");
        return `- ${event.from} -> ${event.to} [${meta || "chat"}]${event.triggeredBy ? ` trig=${event.triggeredBy}` : ""}: ${event.text}`;
      })
      .join("\n");

    const prompt = [
      `You are ${this.name} in HexNest room.`,
      `Assigned role: ${context.role}.`,
      `Rules: ${context.rules}`,
      "Be concrete. Keep output compact and high-signal.",
      "Follow DECIDE -> ACT -> REPORT. If there is no actionable trigger, return a short NO_ACTION reason.",
      "Do not run shell commands or modify files. Reply with text only.",
      "",
      `Task: ${context.task}`,
      `Phase: ${context.phase}`,
      `ContextVersion: ${context.contextVersion || "v1"}`,
      `Summary: ${context.contextSummary || "n/a"}`,
      "",
      "Actionable events:",
      actionable || "(none)",
      "",
      "Timeline:",
      timeline || "(empty)"
    ].join("\n");

    const text = await this.runCodex(prompt);
    return {
      text,
      confidence: inferConfidence(text, context.phase)
    };
  }

  async estimateCost(context: RoomContext, responseText = ""): Promise<CostEstimate> {
    const inputTokens = estimateTokensFromText([
      context.task,
      context.rules,
      context.timeline.map((item) => item.text).join("\n")
    ].join("\n"));
    const outputTokens = estimateTokensFromText(responseText);
    return {
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateUsdFromModel(this.modelId, inputTokens, outputTokens)
    };
  }

  private async runCodex(prompt: string): Promise<string> {
    const outputFile = path.join(os.tmpdir(), `hexnest-codex-${randomUUID()}.txt`);
    const args = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--output-last-message",
      outputFile
    ];
    if (this.model) {
      args.push("--model", this.model);
    }
    args.push("-");

    try {
      const result = await this.runCommand(args, prompt);
      if (result.exitCode !== 0) {
        const errorBody = (result.stderr || result.stdout || "").trim();
        if (errorBody.toLowerCase().includes("not logged in")) {
          throw new Error("Codex CLI is not logged in. Run `codex login` on this machine.");
        }
        throw new Error(`Codex CLI failed (exit=${result.exitCode}): ${errorBody || "unknown error"}`);
      }
      const fileText = await fs.readFile(outputFile, "utf8").catch(() => "");
      const text = String(fileText || "").trim();
      if (!text) {
        throw new Error("Codex CLI returned an empty response");
      }
      return text;
    } finally {
      void fs.rm(outputFile, { force: true }).catch(() => undefined);
    }
  }

  private runCommand(args: string[], stdinPayload: string): Promise<CodexRunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.codexPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 2_000);
      }, this.timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        if (error.code === "ENOENT") {
          reject(new Error("Codex CLI not found in PATH. Install Codex CLI on this machine."));
          return;
        }
        reject(error);
      });

      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        if (timedOut) {
          reject(new Error(`Codex CLI request timed out after ${this.timeoutMs}ms`));
          return;
        }
        resolve({ exitCode, stdout, stderr });
      });

      child.stdin.write(stdinPayload);
      child.stdin.end();
    });
  }
}
