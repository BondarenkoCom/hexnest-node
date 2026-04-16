import { BaseCliAdapter } from "../core/BaseCliAdapter.js";

export class OpenCodeCliAdapter extends BaseCliAdapter {
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
      name: options.name || "opencode-cli",
      modelId: options.model || "opencode",
      capabilities: options.capabilities || ["general", "coding", "reasoning"],
      supportedRoles: options.supportedRoles || ["builder", "researcher", "synthesizer"],
      timeoutMs: Math.max(1_000, Number(options.timeoutMs ?? 120_000))
    });
    this.cliPath = String(options.cliPath || "opencode").trim();
  }

  protected async executeCli(prompt: string): Promise<string> {
    const args = ["chat", prompt];
    
    const result = await this.runCommand(this.cliPath, args, "");
    
    if (result.exitCode !== 0) {
      const errorBody = (result.stderr || result.stdout || "").trim();
      throw new Error(`OpenCode CLI failed (exit=${result.exitCode}): ${errorBody || "unknown error"}`);
    }
    
    const text = String(result.stdout || "").trim();
    if (!text) {
      throw new Error("OpenCode CLI returned an empty response");
    }
    return text;
  }
}

