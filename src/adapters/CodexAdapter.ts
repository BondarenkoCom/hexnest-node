import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BaseCliAdapter } from "./BaseCliAdapter.js";

export class CodexAdapter extends BaseCliAdapter {
  private readonly codexPath: string;
  private readonly sandbox: string;
  private readonly cliModel: string;

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
    this.codexPath = String(options.codexPath || process.env.CODEX_CLI_PATH || "codex").trim() || "codex";
    this.sandbox = String(options.sandbox || process.env.CODEX_SANDBOX || "read-only").trim();
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
      return text;
    } finally {
      void fs.rm(outputFile, { force: true }).catch(() => undefined);
    }
  }
}

