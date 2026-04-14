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

interface GoogleGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export class GoogleAdapter implements AgentAdapter {
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
    this.name = options.name || "google";
    this.model = options.model || "gemini-2.5-flash";
    this.modelId = this.model;
    this.baseUrl = options.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    this.capabilities = options.capabilities || ["general", "reasoning", "coding", "research"];
    this.supportedRoles = options.supportedRoles || ["researcher", "skeptic", "builder", "synthesizer", "judge"];
    this.maxOutputTokens = Math.max(64, Number(process.env.GOOGLE_MAX_TOKENS || 1200));
  }

  private readonly model: string;
  public readonly baseUrl: string;
  private readonly maxOutputTokens: number;
  private lastUsage: UsageSnapshot = { input: 0, output: 0 };

  async respond(context: RoomContext): Promise<AgentResponse> {
    if (!this.apiKey) {
      throw new Error("GOOGLE_API_KEY is missing");
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

    const endpoint = `${this.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: this.maxOutputTokens
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google call failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as GoogleGenerateContentResponse;
    this.lastUsage = extractUsageSnapshot(payload, {
      inputPath: "usageMetadata.promptTokenCount",
      outputPath: "usageMetadata.candidatesTokenCount"
    });

    const text = String(payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "").trim();
    if (!text) {
      throw new Error("Google returned an empty response");
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
