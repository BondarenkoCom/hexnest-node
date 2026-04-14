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
  private lastUsage: UsageSnapshot = { input: 0, output: 0 };

  async respond(context: RoomContext): Promise<AgentResponse> {
    if (!this.apiKey) {
      throw new Error("ANTHROPIC_API_KEY is missing");
    }

    const systemPrompt = buildDiscussionSystemPrompt({
      agentName: this.name,
      role: context.role,
      rules: context.rules,
      styleLine: "Respond with concise, evidence-oriented reasoning."
    });
    const timeline = formatTimeline(context.timeline, 10);
    const actionable = formatActionableEvents(context.actionableEvents);
    const userPrompt = buildDiscussionUserPrompt({
      task: context.task,
      phase: context.phase,
      contextVersion: context.contextVersion,
      contextSummary: context.contextSummary,
      actionableText: actionable,
      timelineText: timeline,
      timelineLabel: "Recent messages"
    });

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
    return estimateCostWithUsageFallback(this.modelId, context, responseText, this.lastUsage);
  }
}
