import { AgentAdapter, AgentResponse } from "../core/AgentAdapter.js";
import { RoomContext } from "../../protocol/types.js";
import { extractUsageSnapshot } from "../core/costing.js";
import { BaseDiscussionAdapter } from "../core/BaseDiscussionAdapter.js";

interface GrokChatResponse {
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

export class GrokAdapter extends BaseDiscussionAdapter {
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
      name: options.name || "grok",
      model: options.model || "grok-4-1-fast",
      baseUrl: options.baseUrl || "https://api.x.ai/v1",
      capabilities: options.capabilities,
      supportedRoles: options.supportedRoles,
      defaultCapabilities: ["general", "reasoning", "coding", "research"],
      defaultRoles: ["researcher", "skeptic", "builder", "synthesizer", "judge"]
    });
    this.maxTokens = Math.max(64, Number(process.env.GROK_MAX_TOKENS || 1200));
  }

  protected async executeCompletion(
    systemPrompt: string, 
    userPrompt: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("GROK_API_KEY is missing");
    }

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
          {
            role: "user",
            content: userPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: this.maxTokens
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Grok call failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as GrokChatResponse;
    this.lastUsage = extractUsageSnapshot(payload, {
      inputPath: "usage.prompt_tokens",
      outputPath: "usage.completion_tokens"
    });
    
    return String(payload.choices?.[0]?.message?.content || "").trim();
  }
}


