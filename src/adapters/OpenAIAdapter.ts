import { AgentAdapter, AgentResponse } from "./AgentAdapter.js";
import { CostEstimate, RoomContext } from "../protocol/types.js";

interface OpenAIChatResponse {
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

export class OpenAIAdapter implements AgentAdapter {
  public readonly name: string;
  public readonly capabilities: string[];
  public readonly supportedRoles: string[];

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
    this.name = options.name || "openai";
    this.model = options.model || "gpt-5-mini";
    this.baseUrl = options.baseUrl || "https://api.openai.com/v1";
    this.capabilities = options.capabilities || ["general", "reasoning", "coding", "research"];
    this.supportedRoles = options.supportedRoles || ["builder", "breaker", "researcher", "synthesizer", "judge"];
  }

  private readonly model: string;
  private readonly baseUrl: string;
  private lastUsage: { input: number; output: number } = { input: 0, output: 0 };

  async respond(context: RoomContext): Promise<AgentResponse> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is missing");
    }

    const systemPrompt = [
      `You are ${this.name} in HexNest room.`,
      `Assigned role: ${context.role}.`,
      `Rules: ${context.rules}`,
      "Be concrete. Keep output compact and high-signal."
    ].join("\n");

    const timeline = context.timeline.slice(-10).map((event) => `${event.from}: ${event.text}`).join("\n");

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
            content: `Task: ${context.task}\nPhase: ${context.phase}\nTimeline:\n${timeline || "(empty)"}`
          }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI call failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as OpenAIChatResponse;
    this.lastUsage = {
      input: Number(payload.usage?.prompt_tokens || 0),
      output: Number(payload.usage?.completion_tokens || 0)
    };
    const text = String(payload.choices?.[0]?.message?.content || "").trim();
    if (!text) {
      throw new Error("OpenAI returned an empty response");
    }
    return {
      text,
      confidence: 0.8
    };
  }

  async estimateCost(context: RoomContext, responseText = ""): Promise<CostEstimate> {
    if (this.lastUsage.input > 0 || this.lastUsage.output > 0) {
      return {
        inputTokens: this.lastUsage.input,
        outputTokens: this.lastUsage.output,
        estimatedCostUsd: 0
      };
    }

    const inputChars = context.task.length + context.rules.length;
    const outputChars = responseText.length;
    return {
      inputTokens: Math.max(1, Math.ceil(inputChars / 4)),
      outputTokens: Math.max(1, Math.ceil(outputChars / 4)),
      estimatedCostUsd: 0
    };
  }
}
