import { AgentAdapter, AgentResponse } from "./AgentAdapter.js";
import { CostEstimate, RoomContext } from "../protocol/types.js";

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

export class OllamaAdapter implements AgentAdapter {
  public readonly name: string;
  public readonly capabilities: string[];
  public readonly supportedRoles: string[];

  constructor(
    options: {
      name?: string;
      model?: string;
      baseUrl?: string;
      capabilities?: string[];
      supportedRoles?: string[];
    } = {}
  ) {
    this.name = options.name || "ollama-local";
    this.model = options.model || "qwen2.5:14b";
    this.baseUrl = options.baseUrl || "http://localhost:11434";
    this.capabilities = options.capabilities || ["general", "code", "research"];
    this.supportedRoles = options.supportedRoles || ["researcher", "skeptic", "builder", "bull", "bear"];
  }

  private readonly model: string;
  private readonly baseUrl: string;

  async respond(context: RoomContext): Promise<AgentResponse> {
    const system = [
      `You are ${this.name}, role=${context.role}.`,
      `Task: ${context.task}`,
      `Phase: ${context.phase}`,
      `Rules: ${context.rules}`,
      "Respond with direct, evidence-focused, concise output."
    ].join("\n");
    const latest = context.timeline.slice(-8).map((event) => `${event.from}: ${event.text}`).join("\n");
    const prompt = `${system}\n\nRecent timeline:\n${latest || "(empty)"}`;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ]
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama call failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as OllamaChatResponse;
    const text = String(payload.message?.content || "").trim();
    if (!text) {
      throw new Error("Ollama returned an empty response");
    }
    return {
      text,
      confidence: 0.72
    };
  }

  async estimateCost(context: RoomContext, responseText = ""): Promise<CostEstimate> {
    const inputChars =
      context.task.length +
      context.rules.length +
      context.timeline.reduce((sum, item) => sum + item.text.length, 0);
    const outputChars = responseText.length;
    const inputTokens = Math.max(1, Math.ceil(inputChars / 4));
    const outputTokens = Math.max(1, Math.ceil(outputChars / 4));
    return {
      inputTokens,
      outputTokens,
      estimatedCostUsd: 0
    };
  }
}
