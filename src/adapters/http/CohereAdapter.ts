import { BaseDiscussionAdapter } from "../core/BaseDiscussionAdapter.js";
import { extractUsageSnapshot } from "../core/costing.js";

interface CohereChatResponse {
  text?: string;
  meta?: {
    tokens?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
}

export class CohereAdapter extends BaseDiscussionAdapter {
  protected readonly styleLine = "Be concrete. Keep output compact and high-signal.";
  private readonly maxTokens: number;

  constructor(
    private readonly apiKey: string,
    options: {
      name?: string;
      model?: string;
      baseUrl?: string;
      capabilities?: string[];
      supportedRoles?: string[];
    } = {}
  ) {
    super({
      name: options.name || "cohere",
      model: options.model || "command-r-plus",
      baseUrl: options.baseUrl || "https://api.cohere.ai/v1",
      capabilities: options.capabilities,
      supportedRoles: options.supportedRoles,
      defaultCapabilities: ["general", "reasoning", "research"],
      defaultRoles: ["researcher", "synthesizer", "judge"]
    });
    this.maxTokens = Math.max(64, Number(process.env.COHERE_MAX_TOKENS || 1200));
  }

  protected async executeCompletion(
    systemPrompt: string, 
    userPrompt: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("COHERE_API_KEY is missing");
    }

    const endpoint = `${(this.baseUrl || "").replace(/\/+$/, "")}/chat`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        preamble: systemPrompt,
        message: userPrompt,
        temperature: 0.3,
        max_tokens: this.maxTokens
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Cohere call failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as CohereChatResponse;
    
    this.lastUsage = extractUsageSnapshot(payload, {
      inputPath: "meta.tokens.input_tokens",
      outputPath: "meta.tokens.output_tokens"
    });
    
    return String(payload.text || "").trim();
  }
}

