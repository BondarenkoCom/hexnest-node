import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BaseCliAdapter } from "../core/BaseCliAdapter.js";
import { resolveCodexCliPath } from "../../utils/codex-cli.js";

export class CodexAdapter extends BaseCliAdapter {
  private readonly codexPath: string;
  private readonly sandbox: string;
  private readonly cliModel: string;
  private readonly trace: boolean;

  constructor(
    options: {
      name?: string;
      model?: string;
      capabilities?: string[];
      supportedRoles?: string[];
      timeoutMs?: number;
      codexPath?: string;
      sandbox?: string;
    } = {}
  ) {
    const rawModel = String(options.model || process.env.CODEX_MODEL || "").trim();
    super({
      name: options.name || "codex",
      modelId: rawModel || "codex-cli",
      capabilities: options.capabilities || ["general", "reasoning", "coding", "research"],
      supportedRoles: options.supportedRoles || ["builder", "researcher", "skeptic", "synthesizer", "judge"],
      timeoutMs: Math.max(1_000, Number(options.timeoutMs ?? process.env.CODEX_TIMEOUT_MS ?? 120_000))
    });
    this.cliModel = rawModel;
    this.codexPath = resolveCodexCliPath(String(options.codexPath || process.env.CODEX_CLI_PATH || "codex")).resolved;
    this.sandbox = String(options.sandbox || process.env.CODEX_SANDBOX || "read-only").trim();
    this.trace = String(process.env.HEXNEST_CODEX_TRACE || "").trim() === "1";
  }

  protected async executeCli(prompt: string): Promise<string> {
    const outputFile = path.join(os.tmpdir(), `hexnest-codex-${randomUUID()}.txt`);
    const args = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      this.sandbox,
      "--output-last-message",
      outputFile
    ];
    if (this.cliModel) {
      args.push("--model", this.cliModel);
    }
    args.push("-");

    try {
      if (this.trace) {
        const max = Math.max(256, Number(process.env.HEXNEST_CODEX_TRACE_MAX_CHARS || 8000));
        const snippet = prompt.length > max ? `${prompt.slice(0, max)}\n...<truncated>...` : prompt;
        console.log(
          `[codex-cli] request model=${this.cliModel || "default"} sandbox=${this.sandbox} cmd=${this.codexPath} args=${JSON.stringify(args)} promptChars=${prompt.length}\n${snippet}`
        );
      }
      const result = await this.runCommand(this.codexPath, args, prompt);
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
      if (this.trace) {
        const max = Math.max(256, Number(process.env.HEXNEST_CODEX_TRACE_MAX_CHARS || 8000));
        const snippet = text.length > max ? `${text.slice(0, max)}\n...<truncated>...` : text;
        console.log(`[codex-cli] response chars=${text.length}\n${snippet}`);
      }
      return text;
    } finally {
      void fs.rm(outputFile, { force: true }).catch(() => undefined);
    }
  }
}
