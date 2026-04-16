import { BaseDiscussionAdapter } from "../core/BaseDiscussionAdapter.js";
import { extractUsageSnapshot } from "../core/costing.js";

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

export class LmStudioAdapter extends BaseDiscussionAdapter {
  protected readonly styleLine = "Be concrete. Keep output compact and high-signal.";
  private readonly maxTokens: number;

  constructor(
    private readonly apiKey: string = "not-needed",
    options: {
      name?: string;
      model?: string;
      baseUrl?: string;
      capabilities?: string[];
      supportedRoles?: string[];
    } = {}
  ) {
    super({
      name: options.name || "lm-studio",
      model: options.model || "local-model",
      baseUrl: options.baseUrl || "http://127.0.0.1:1234/v1",
      capabilities: options.capabilities,
      supportedRoles: options.supportedRoles,
      defaultCapabilities: ["general", "reasoning", "coding", "research"],
      defaultRoles: ["builder", "breaker", "researcher", "synthesizer", "judge"]
    });
    this.maxTokens = Math.max(64, Number(process.env.LMSTUDIO_MAX_TOKENS || 1200));
  }

  protected async executeCompletion(
    systemPrompt: string, 
    userPrompt: string
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
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
      throw new Error(`LM Studio call failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as OpenAILikeChatResponse;
    this.lastUsage = extractUsageSnapshot(payload, {
      inputPath: "usage.prompt_tokens",
      outputPath: "usage.completion_tokens"
    });
    
    return String(payload.choices?.[0]?.message?.content || "").trim();
  }
}
