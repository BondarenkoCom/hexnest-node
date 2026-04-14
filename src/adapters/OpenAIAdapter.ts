import {
  AgentAdapter,
  AgentResponse,
  inferConfidence
} from "./AgentAdapter.js";
import { CostEstimate, RoomContext } from "../protocol/types.js";
import { estimateCostWithUsageFallback, extractUsageSnapshot, UsageSnapshot } from "./costing.js";
import {
  buildDiscussionSystemPrompt,
  buildDiscussionUserPrompt,
  formatActionableEvents,
  formatTimeline
} from "./prompting.js";

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
    this.name = options.name || "openai";
    this.model = options.model || "gpt-4o-mini";
    this.modelId = this.model;
    this.baseUrl = options.baseUrl || "https://api.openai.com/v1";
    this.capabilities = options.capabilities || ["general", "reasoning", "coding", "research"];
    this.supportedRoles = options.supportedRoles || ["builder", "breaker", "researcher", "synthesizer", "judge"];
    this.maxTokens = Math.max(64, Number(process.env.OPENAI_MAX_TOKENS || 1200));
  }

  private readonly model: string;
  public readonly baseUrl: string;
  private readonly maxTokens: number;
  private lastUsage: UsageSnapshot = { input: 0, output: 0 };

  async respond(context: RoomContext): Promise<AgentResponse> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is missing");
    }

    const systemPrompt = buildDiscussionSystemPrompt({
      agentName: this.name,
      role: context.role,
      rules: context.rules,
      styleLine: "Be concrete. Keep output compact and high-signal."
    });

    const timeline = formatTimeline(context.timeline, 10);
    const actionable = formatActionableEvents(context.actionableEvents);
    const userPrompt = buildDiscussionUserPrompt({
      task: context.task,
      phase: context.phase,
      contextVersion: context.contextVersion,
      contextSummary: context.contextSummary,
      actionableText: actionable,
      timelineText: timeline
    });

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
      throw new Error(`OpenAI call failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as OpenAIChatResponse;
    this.lastUsage = extractUsageSnapshot(payload, {
      inputPath: "usage.prompt_tokens",
      outputPath: "usage.completion_tokens"
    });
    const text = String(payload.choices?.[0]?.message?.content || "").trim();
    if (!text) {
      throw new Error("OpenAI returned an empty response");
    }
    return {
      text,
      confidence: inferConfidence(text, context.phase)
    };
  }

  async estimateCost(context: RoomContext, responseText = ""): Promise<CostEstimate> {
    return estimateCostWithUsageFallback(this.modelId, context, responseText, this.lastUsage);
  }
}
