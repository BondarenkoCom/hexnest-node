import { spawn } from "node:child_process";
import {
  AgentAdapter,
  AgentResponse,
  estimateTokensFromText,
  estimateUsdFromModel,
  inferConfidence,
  parseStructuredAgentResponse
} from "../core/AgentAdapter.js";
import { CostEstimate, RoomContext } from "../../protocol/types.js";
import { formatActionableEvents, formatTimeline, structuredOutputGuidance } from "./prompting.js";

export interface CliRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Base adapter for interacting with CLI-based AI tools (Codex, Claude Code, GitHub Copilot CLI, etc.)
 */
export abstract class BaseCliAdapter implements AgentAdapter {
  public readonly name: string;
  public readonly modelId: string;
  public readonly capabilities: string[];
  public readonly supportedRoles: string[];
  protected readonly timeoutMs: number;

  constructor(options: {
    name: string;
    modelId: string;
    capabilities: string[];
    supportedRoles: string[];
    timeoutMs: number;
  }) {
    this.name = options.name;
    this.modelId = options.modelId;
    this.capabilities = options.capabilities;
    this.supportedRoles = options.supportedRoles;
    this.timeoutMs = options.timeoutMs;
  }

  async respond(context: RoomContext): Promise<AgentResponse> {
    const timeline = formatTimeline(context.timeline, 10);
    const actionable = formatActionableEvents(context.actionableEvents);

    const prompt = [
      `You are ${this.name} in HexNest room.`,
      `Assigned role: ${context.role}.`,
      `Rules: ${context.rules}`,
      "Be concrete. Keep output compact and high-signal.",
      "Follow DECIDE -> ACT -> REPORT. If there is no actionable trigger, return a short NO_ACTION reason.",
      "Do not run shell commands or modify files. Reply with text only.",
      ...structuredOutputGuidance(),
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

    const rawText = await this.executeCli(prompt);
    const parsed = parseStructuredAgentResponse(rawText);
    
    const output: AgentResponse = {
      text: parsed.text,
      confidence: inferConfidence(parsed.text, context.phase)
    };
    if (parsed.step1Envelope) {
      output.step1Envelope = parsed.step1Envelope;
    }
    if (context.enableSentimentAnalysis) {
      output.sentiment = parsed.sentiment;
    }
    return output;
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

  /**
   * Implement this method to actually invoke the CLI and parse the result.
   */
  protected abstract executeCli(prompt: string): Promise<string>;

  /**
   * Helper to spawn a CLI process securely and manage timeouts/Platform specifics.
   */
  protected runCommand(command: string, args: string[], stdinPayload: string): Promise<CliRunResult> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === "win32";
      // On Windows, .cmd files require shell:true to execute.
      const child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
        shell: isWindows
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const killChild = (): void => {
        if (process.platform === "win32" && child.pid) {
          // Taskkill subtree
          spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
        } else {
          child.kill("SIGTERM");
          setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 2_000);
        }
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        killChild();
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
          reject(new Error(`CLI executable '${command}' not found in PATH.`));
          return;
        }
        reject(error);
      });

      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        if (timedOut) {
          reject(new Error(`CLI request to '${command}' timed out after ${this.timeoutMs}ms`));
          return;
        }
        resolve({ exitCode, stdout, stderr });
      });

      if (stdinPayload) {
        child.stdin.write(stdinPayload);
      }
      child.stdin.end();
    });
  }
}
