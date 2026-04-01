import {
  AgentAdapter,
  AgentResponse,
  estimateTokensFromText,
  estimateUsdFromModel,
  inferConfidence
} from "./AgentAdapter.js";
import { CostEstimate, RoomContext } from "../protocol/types.js";

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

export class OllamaAdapter implements AgentAdapter {
  public readonly name: string;
  public readonly modelId: string;
  public readonly capabilities: string[];
  public readonly supportedRoles: string[];

  constructor(
    options: {
      name?: string;
      model?: string;
      baseUrl?: string;
      capabilities?: string[];
      supportedRoles?: string[];
      timeoutMs?: number;
      maxOutputTokens?: number;
    } = {}
  ) {
    this.name = options.name || "ollama-local";
    this.model = options.model || "qwen2.5:14b";
    this.modelId = this.model;
    this.baseUrl = options.baseUrl || "http://localhost:11434";
    this.timeoutMs = Math.max(1_000, Number(options.timeoutMs ?? process.env.OLLAMA_TIMEOUT_MS ?? 45_000));
    this.maxOutputTokens = Math.max(64, Number(options.maxOutputTokens ?? process.env.OLLAMA_NUM_PREDICT ?? 900));
    this.capabilities = options.capabilities || ["general", "code", "research"];
    this.supportedRoles = options.supportedRoles || ["researcher", "skeptic", "builder", "bull", "bear"];
  }

  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;

  async respond(context: RoomContext): Promise<AgentResponse> {
    const system = [
      `You are ${this.name}, role=${context.role}.`,
      `Task: ${context.task}`,
      `Phase: ${context.phase}`,
      `Rules: ${context.rules}`,
      "Respond with direct, evidence-focused, concise output."
    ].join("\n");
    const latest = context.timeline.slice(-8).map((event) => `${event.from}: ${event.text}`).join("\n");
    const prompt = [
      `Task: ${context.task}`,
      `Phase: ${context.phase}`,
      "Recent timeline:",
      latest || "(empty)"
    ].join("\n\n");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          options: {
            num_predict: this.maxOutputTokens
          },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt }
          ]
        })
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error(`Ollama request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

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
      confidence: inferConfidence(text, context.phase)
    };
  }

  async estimateCost(context: RoomContext, responseText = ""): Promise<CostEstimate> {
    const inputText = [
      context.task,
      context.rules,
      context.timeline.map((item) => item.text).join("\n")
    ].join("\n");
    const inputTokens = estimateTokensFromText(inputText);
    const outputTokens = estimateTokensFromText(responseText);
    return {
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateUsdFromModel(this.modelId, inputTokens, outputTokens)
    };
  }
}
