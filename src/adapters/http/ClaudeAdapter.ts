import { AgentAdapter, AgentResponse, parseEmotionFromResponse } from "../core/AgentAdapter.js";
import { RoomContext } from "../../protocol/types.js";
import { extractUsageSnapshot } from "../core/costing.js";
import { BaseDiscussionAdapter } from "../core/BaseDiscussionAdapter.js";

interface ClaudeResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class ClaudeAdapter extends BaseDiscussionAdapter {
  protected readonly styleLine = "Respond with concise, evidence-oriented reasoning.";

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
      name: options.name || "claude",
      model: options.model || "claude-3-7-sonnet-latest",
      baseUrl: options.baseUrl || "https://api.anthropic.com/v1",
      capabilities: options.capabilities,
      supportedRoles: options.supportedRoles,
      defaultCapabilities: ["reasoning", "analysis", "writing"],
      defaultRoles: ["skeptic", "judge", "arbiter", "synthesizer"]
    });
  }

  protected override getTimelineLabel(): string {
    return "Recent messages";
  }

  protected async executeCompletion(
    systemPrompt: string, 
    userPrompt: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("ANTHROPIC_API_KEY is missing");
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 900,
        temperature: 0.25,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Claude call failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as ClaudeResponse;
    this.lastUsage = extractUsageSnapshot(payload, {
      inputPath: "usage.input_tokens",
      outputPath: "usage.output_tokens"
    });
    
    return payload.content?.find((item) => item.type === "text")?.text?.trim() || "";
  }
}



