import {
  AgentAdapter,
  AgentResponse,
  inferConfidence
} from "./AgentAdapter.js";
import { CostEstimate, RoomContext } from "../protocol/types.js";
import { estimateCostWithUsageFallback } from "./costing.js";
import {
  buildDiscussionSystemPrompt,
  buildDiscussionUserPrompt,
  formatActionableEvents,
  formatTimeline
} from "./prompting.js";

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

interface CachedResponse {
  value: AgentResponse;
  expiry: number;
}

type OllamaResponseMode = "standard" | "slow_model";

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
      responseMode?: OllamaResponseMode;
    } = {}
  ) {
    this.name = options.name || "ollama-local";
    this.model = options.model || "qwen2.5:14b";
    this.modelId = this.model;
    this.baseUrl = options.baseUrl || "http://127.0.0.1:11434";
    this.timeoutMs = Math.max(90_000, Number(options.timeoutMs ?? 90_000));
    this.maxOutputTokens = Math.max(64, Number(options.maxOutputTokens ?? process.env.OLLAMA_NUM_PREDICT ?? 900));
    this.responseMode = options.responseMode === "slow_model" ? "slow_model" : "standard";
    this.capabilities = options.capabilities || ["general", "code", "research"];
    this.supportedRoles = options.supportedRoles || ["researcher", "skeptic", "builder", "bull", "bear"];
    this.responseCache = new Map();
    // Cache TTL: 30 minutes by default, configurable via OLLAMA_CACHE_TTL_MS env var, or 0 to disable
    const ttlMs = Number(process.env.OLLAMA_CACHE_TTL_MS ?? 30 * 60 * 1000);
    this.cacheExpiry = ttlMs > 0 ? ttlMs : 1; // 1ms = effectively disabled
  }

  private readonly model: string;
  public readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly responseMode: OllamaResponseMode;
  private readonly responseCache: Map<string, CachedResponse>;
  private readonly cacheExpiry: number;

  private generateCacheKey(context: RoomContext): string {
    // Generate cache key from deterministic context attributes
    const cacheKeyData = {
      task: context.task,
      phase: context.phase,
      role: context.role,
      rules: context.rules,
      // Timeline affects context, include last 3 items for cache differentiation
      recentTimeline: context.timeline.slice(-3).map((e) => `${e.from}:${e.text.slice(0, 50)}`).join("|")
    };
    return JSON.stringify(cacheKeyData);
  }

  private getCachedResponse(context: RoomContext): AgentResponse | null {
    const key = this.generateCacheKey(context);
    const cached = this.responseCache.get(key);

    if (!cached) return null;

    // Check if cache is still valid
    if (Date.now() > cached.expiry) {
      this.responseCache.delete(key);
      return null;
    }

    console.debug(`[${this.name}] Using cached response for task: ${context.task.slice(0, 50)}...`);
    return cached.value;
  }

  private setCachedResponse(context: RoomContext, response: AgentResponse): void {
    const key = this.generateCacheKey(context);
    this.responseCache.set(key, {
      value: response,
      expiry: Date.now() + this.cacheExpiry
    });
    console.debug(`[${this.name}] Cached response for task: ${context.task.slice(0, 50)}... (TTL: 30m)`);
  }

  public clearCache(): void {
    const previousSize = this.responseCache.size;
    this.responseCache.clear();
    console.info(`[${this.name}] Cleared response cache (old size: ${previousSize})`);
  }

  async respond(context: RoomContext): Promise<AgentResponse> {
    // Check cache first
    const cachedResponse = this.getCachedResponse(context);
    if (cachedResponse) {
      return cachedResponse;
    }

    const system = buildDiscussionSystemPrompt({
      agentName: this.name,
      role: context.role,
      rules: context.rules,
      styleLine: "Respond with direct, evidence-focused, concise output.",
      includeTaskLine: `Task: ${context.task}`,
      includePhaseLine: `Phase: ${context.phase}`
    });
    const isSlowModelMode = this.responseMode === "slow_model";
    const latest = formatTimeline(context.timeline, isSlowModelMode ? 5 : 8);
    const actionable = formatActionableEvents(
      isSlowModelMode ? (context.actionableEvents || []).slice(-4) : context.actionableEvents
    );
    const prompt = buildDiscussionUserPrompt({
      task: context.task,
      phase: context.phase,
      contextVersion: context.contextVersion,
      contextSummary: context.contextSummary,
      actionableText: actionable,
      timelineText: latest,
      timelineLabel: "Recent timeline"
    });

    let response: Response;
    try {
      const initialPredict = isSlowModelMode
        ? Math.max(128, Math.min(this.maxOutputTokens, 420))
        : this.maxOutputTokens;
      const initialTimeoutMs = isSlowModelMode ? Math.max(this.timeoutMs, 120_000) : this.timeoutMs;
      response = await this.requestOllamaChat(system, prompt, initialPredict, initialTimeoutMs);
    } catch (error: any) {
      if (this.isTimeoutError(error)) {
        const compactTimeline = formatTimeline(context.timeline, 4);
        const compactActionable = formatActionableEvents((context.actionableEvents || []).slice(-3));
        const compactPrompt = buildDiscussionUserPrompt({
          task: context.task,
          phase: context.phase,
          contextVersion: context.contextVersion,
          contextSummary: context.contextSummary,
          actionableText: compactActionable,
          timelineText: compactTimeline,
          timelineLabel: "Compact timeline"
        });
        const reducedPredict = Math.max(128, Math.min(this.maxOutputTokens, 420));
        const retryTimeoutMs = Math.max(this.timeoutMs, isSlowModelMode ? 180_000 : 120_000);
        console.warn(
          `[${this.name}] primary request timed out (${this.timeoutMs}ms), retrying with compact context and num_predict=${reducedPredict}`
        );
        response = await this.requestOllamaChat(system, compactPrompt, reducedPredict, retryTimeoutMs);
      } else {
        throw error;
      }
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

    const result = {
      text,
      confidence: inferConfidence(text, context.phase)
    };

    // Cache the response before returning
    this.setCachedResponse(context, result);

    return result;
  }

  async estimateCost(context: RoomContext, responseText = ""): Promise<CostEstimate> {
    return estimateCostWithUsageFallback(this.modelId, context, responseText);
  }

  private isTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || "");
    return /timed out/i.test(message);
  }

  private async requestOllamaChat(
    system: string,
    prompt: string,
    numPredict: number,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          options: {
            num_predict: numPredict
          },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt }
          ]
        })
      });
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error(`Ollama request timed out after ${timeoutMs}ms`);
      }
      if (error?.code === "ECONNREFUSED" || String(error?.message || "").includes("fetch failed")) {
        throw new Error(`Ollama is NOT responding at ${this.baseUrl}. Please ensure Ollama is running and accessible.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
