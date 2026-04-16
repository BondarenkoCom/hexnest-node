import { BaseCliAdapter } from "../core/BaseCliAdapter.js";

export class CopilotCliAdapter extends BaseCliAdapter {
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
      name: options.name || "copilot-cli",
      modelId: options.model || "copilot-cli",
      capabilities: options.capabilities || ["general", "coding"],
      supportedRoles: options.supportedRoles || ["builder", "researcher"],
      timeoutMs: Math.max(1_000, Number(options.timeoutMs ?? 120_000))
    });
    // Expected to be 'gh' with 'copilot' as first arg, or direct binary
    this.cliPath = String(options.cliPath || "gh").trim();
  }

  protected async executeCli(prompt: string): Promise<string> {
    // Basic standard structure for github copilot cli `gh copilot explain` or `suggest`
    const args = ["copilot", "explain", prompt];
    
    const result = await this.runCommand(this.cliPath, args, "");
    
    if (result.exitCode !== 0) {
      const errorBody = (result.stderr || result.stdout || "").trim();
      throw new Error(`Copilot CLI failed (exit=${result.exitCode}): ${errorBody || "unknown error"}`);
    }
    
    const text = String(result.stdout || "").trim();
    if (!text) {
      throw new Error("Copilot CLI returned an empty response");
    }
    return text;
  }
}

