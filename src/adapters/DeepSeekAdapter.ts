import { BaseDiscussionAdapter } from "./BaseDiscussionAdapter.js";
import { extractUsageSnapshot } from "./costing.js";

interface OpenAILikeChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class DeepSeekAdapter extends BaseDiscussionAdapter {
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
      name: options.name || "deepseek",
      model: options.model || "deepseek-chat",
      baseUrl: options.baseUrl || "https://api.deepseek.com",
      capabilities: options.capabilities,
      supportedRoles: options.supportedRoles,
      defaultCapabilities: ["general", "reasoning", "coding", "research"],
      defaultRoles: ["researcher", "builder", "judge", "synthesizer"]
    });
    this.maxTokens = Math.max(64, Number(process.env.DEEPSEEK_MAX_TOKENS || 1200));
  }

  protected async executeCompletion(
    systemPrompt: string, 
    userPrompt: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is missing");
    }

    const endpoint = `${(this.baseUrl || "").replace(/\/+$/, "")}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: this.maxTokens
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`DeepSeek call failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as OpenAILikeChatResponse;
    this.lastUsage = extractUsageSnapshot(payload, {
      inputPath: "usage.prompt_tokens",
      outputPath: "usage.completion_tokens"
    });
    
    return String(payload.choices?.[0]?.message?.content || "").trim();
  }
}
