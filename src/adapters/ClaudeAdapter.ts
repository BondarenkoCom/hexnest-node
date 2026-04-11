import {
  AgentAdapter,
  AgentResponse,
  estimateTokensFromText,
  estimateUsdFromModel,
  inferConfidence
} from "./AgentAdapter.js";
import { CostEstimate, RoomContext } from "../protocol/types.js";

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

export class ClaudeAdapter implements AgentAdapter {
  public readonly name: string;
  public readonly modelId: string;
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
    this.name = options.name || "claude";
    this.model = options.model || "claude-3-7-sonnet-latest";
    this.modelId = this.model;
    this.baseUrl = options.baseUrl || "https://api.anthropic.com/v1";
    this.capabilities = options.capabilities || ["reasoning", "analysis", "writing"];
    this.supportedRoles = options.supportedRoles || ["skeptic", "judge", "arbiter", "synthesizer"];
  }

  private readonly model: string;
  public readonly baseUrl: string;
  private lastUsage: { input: number; output: number } = { input: 0, output: 0 };

  async respond(context: RoomContext): Promise<AgentResponse> {
    if (!this.apiKey) {
      throw new Error("ANTHROPIC_API_KEY is missing");
    }

    const systemPrompt = [
      `You are ${this.name}.`,
      `Assigned role: ${context.role}.`,
      `Rules: ${context.rules}`,
      "Respond with concise, evidence-oriented reasoning."
    ].join("\n");
    const userPrompt = [
      `Task: ${context.task}`,
      `Phase: ${context.phase}`,
      "Recent messages:",
      context.timeline.slice(-10).map((event) => `${event.from}: ${event.text}`).join("\n") || "(empty)"
    ].join("\n\n");

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
    this.lastUsage = {
      input: Number(payload.usage?.input_tokens || 0),
      output: Number(payload.usage?.output_tokens || 0)
    };
    const text = payload.content?.find((item) => item.type === "text")?.text?.trim() || "";
    if (!text) {
      throw new Error("Claude returned an empty response");
    }
    return {
      text,
      confidence: inferConfidence(text, context.phase)
    };
  }

  async estimateCost(context: RoomContext, responseText = ""): Promise<CostEstimate> {
    if (this.lastUsage.input > 0 || this.lastUsage.output > 0) {
      return {
        inputTokens: this.lastUsage.input,
        outputTokens: this.lastUsage.output,
        estimatedCostUsd: estimateUsdFromModel(this.modelId, this.lastUsage.input, this.lastUsage.output)
      };
    }
    const inputTokens = estimateTokensFromText([
      context.task,
      context.rules,
      context.timeline.map((event) => event.text).join("\n")
    ].join("\n"));
    const outputTokens = estimateTokensFromText(responseText);
    return {
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateUsdFromModel(this.modelId, inputTokens, outputTokens)
    };
  }
}
