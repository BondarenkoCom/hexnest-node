import { BaseCliAdapter } from "../core/BaseCliAdapter.js";

export class ClaudeCodeCliAdapter extends BaseCliAdapter {
  private readonly cliPath: string;

  constructor(
    options: {
      name?: string;
      model?: string;
      capabilities?: string[];
      supportedRoles?: string[];
      timeoutMs?: number;
      cliPath?: string;
    } = {}
  ) {
    super({
      name: options.name || "claude-code-cli",
      modelId: options.model || "claude-3-7-sonnet-latest",
      capabilities: options.capabilities || ["general", "reasoning", "coding", "research"],
      supportedRoles: options.supportedRoles || ["builder", "researcher", "judge", "synthesizer"],
      timeoutMs: Math.max(1_000, Number(options.timeoutMs ?? 120_000))
    });
    this.cliPath = String(options.cliPath || "claude").trim();
  }

  protected async executeCli(prompt: string): Promise<string> {
    const args = ["-p", prompt];
    
    const result = await this.runCommand(this.cliPath, args, "");
    
    if (result.exitCode !== 0) {
      const errorBody = (result.stderr || result.stdout || "").trim();
      throw new Error(`Claude Code CLI failed (exit=${result.exitCode}): ${errorBody || "unknown error"}`);
    }
    
    const text = String(result.stdout || "").trim();
    if (!text) {
      throw new Error("Claude Code CLI returned an empty response");
    }
    return text;
  }
}

