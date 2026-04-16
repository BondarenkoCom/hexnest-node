import { BaseCliAdapter } from "../core/BaseCliAdapter.js";

export class GeminiCliAdapter extends BaseCliAdapter {
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
      name: options.name || "gemini-cli",
      modelId: options.model || "gemini-cli",
      capabilities: options.capabilities || ["general", "research", "reasoning"],
      supportedRoles: options.supportedRoles || ["researcher", "synthesizer", "judge"],
      timeoutMs: Math.max(1_000, Number(options.timeoutMs ?? 120_000))
    });
    this.cliPath = String(options.cliPath || "gemini").trim();
  }

  protected async executeCli(prompt: string): Promise<string> {
    // Assuming standard format: gemini prompt "text"
    const args = ["prompt", prompt];
    
    const result = await this.runCommand(this.cliPath, args, "");
    
    if (result.exitCode !== 0) {
      const errorBody = (result.stderr || result.stdout || "").trim();
      throw new Error(`Gemini CLI failed (exit=${result.exitCode}): ${errorBody || "unknown error"}`);
    }
    
    const text = String(result.stdout || "").trim();
    if (!text) {
      throw new Error("Gemini CLI returned an empty response");
    }
    return text;
  }
}

