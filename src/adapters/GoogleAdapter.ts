import {
  AgentAdapter,
  AgentResponse,
  estimateTokensFromText,
  estimateUsdFromModel,
  inferConfidence
} from "./AgentAdapter.js";
import { CostEstimate, RoomContext } from "../protocol/types.js";

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
  private lastUsage: { input: number; output: number } = { input: 0, output: 0 };

  async respond(context: RoomContext): Promise<AgentResponse> {
    if (!this.apiKey) {
      throw new Error("GOOGLE_API_KEY is missing");
    }

    const systemPrompt = [
      `You are ${this.name} in HexNest room.`,
      `Assigned role: ${context.role}.`,
      `Rules: ${context.rules}`,
      "Be concrete. Keep output compact and high-signal.",
      "Follow DECIDE -> ACT -> REPORT. If there is no actionable trigger, return a short NO_ACTION reason."
    ].join("\n");

    const timeline = context.timeline
      .slice(-10)
      .map((event) => {
        const meta = [event.scope, event.type, event.intent].filter(Boolean).join("/");
        const trigger = event.triggeredBy ? ` trig=${event.triggeredBy}` : "";
        return `${event.from} -> ${event.to} [${meta || "chat"}]${trigger}: ${event.text}`;
      })
      .join("\n");

    const actionable = (context.actionableEvents || [])
      .map((event) => {
        const meta = [event.scope, event.type, event.intent].filter(Boolean).join("/");
        return `- ${event.from} -> ${event.to} [${meta || "chat"}]${event.triggeredBy ? ` trig=${event.triggeredBy}` : ""}: ${event.text}`;
      })
      .join("\n");

    const userPrompt = `Task: ${context.task}\nPhase: ${context.phase}\nContextVersion: ${context.contextVersion || "v1"}\nSummary: ${context.contextSummary || "n/a"}\nActionable events:\n${actionable || "(none)"}\nTimeline:\n${timeline || "(empty)"}`;

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
    this.lastUsage = {
      input: Number(payload.usageMetadata?.promptTokenCount || 0),
      output: Number(payload.usageMetadata?.candidatesTokenCount || 0)
    };

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
      context.timeline.map((item) => item.text).join("\n")
    ].join("\n"));
    const outputTokens = estimateTokensFromText(responseText);
    return {
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateUsdFromModel(this.modelId, inputTokens, outputTokens)
    };
  }
}
