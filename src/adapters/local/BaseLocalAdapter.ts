import {
  AgentAdapter,
  AgentResponse,
  inferConfidence,
  parseStructuredAgentResponse
} from "../core/AgentAdapter.js";
import { CostEstimate, RoomContext } from "../../protocol/types.js";
import { estimateCostWithUsageFallback } from "../core/costing.js";
import {
  buildDiscussionSystemPrompt,
  buildDiscussionUserPrompt,
  formatActionableEvents,
  formatTimeline
} from "../core/prompting.js";
import { traceNodeModelError, traceNodeModelSuccess } from "../../utils/model-trace.js";

interface CachedResponse {
  value: AgentResponse;
  expiry: number;
}

export type LocalAdapterResponseMode = "standard" | "slow_model";

export interface LocalAdapterOptions {
  name?: string;
  model?: string;
  baseUrl?: string;
  capabilities?: string[];
  supportedRoles?: string[];
  timeoutMs?: number;
  maxOutputTokens?: number;
  responseMode?: LocalAdapterResponseMode;
  cacheKey?: string;
}

/**
 * Base class for local model adapters with shared functionality:
 * - Response caching (30min TTL by default)
 * - Timeout handling with automatic retry
 * - Slow model mode for large models (14B+)
 * - Dynamic context reduction on timeout
 * - Sentiment parsing and confidence inference
 */
export abstract class BaseLocalAdapter implements AgentAdapter {
  public readonly name: string;
  public readonly modelId: string;
  public readonly capabilities: string[];
  public readonly supportedRoles: string[];
  public readonly baseUrl: string;

  protected readonly model: string;
  protected readonly timeoutMs: number;
  protected readonly maxOutputTokens: number;
  protected readonly responseMode: LocalAdapterResponseMode;
  protected readonly styleLine: string;

  private readonly responseCache: Map<string, CachedResponse>;
  private readonly cacheExpiry: number;

  constructor(
    defaultName: string,
    defaultModel: string,
    defaultBaseUrl: string,
    defaultMaxTokensEnvVar: string,
    cacheEnvVar: string,
    options: LocalAdapterOptions = {},
    defaultCapabilities?: string[],
    defaultRoles?: string[],
    defaultStyleLine?: string
  ) {
    this.name = options.name || defaultName;
    this.model = options.model || defaultModel;
    this.modelId = this.model;
    this.baseUrl = options.baseUrl || defaultBaseUrl;
    this.timeoutMs = Math.max(90_000, Number(options.timeoutMs ?? 90_000));
    this.maxOutputTokens = Math.max(
      64,
      Number(options.maxOutputTokens ?? process.env[defaultMaxTokensEnvVar] ?? 900)
    );
    this.responseMode = options.responseMode === "slow_model" ? "slow_model" : "standard";
    this.capabilities = options.capabilities || defaultCapabilities || ["general", "reasoning", "coding", "research"];
    this.supportedRoles = options.supportedRoles || defaultRoles || [
      "builder",
      "breaker",
      "researcher",
      "synthesizer",
      "judge"
    ];
    this.styleLine = defaultStyleLine || "Be concrete. Keep output compact and high-signal.";
    this.responseCache = new Map();
    const ttlMs = Number(process.env[cacheEnvVar] ?? 30 * 60 * 1000);
    this.cacheExpiry = ttlMs > 0 ? ttlMs : 1;
  }

  private generateCacheKey(context: RoomContext): string {
    const cacheKeyData = {
      task: context.task,
      phase: context.phase,
      role: context.role,
      rules: context.rules,
      recentTimeline: context.timeline
        .slice(-3)
        .map((e) => `${e.from}:${e.text.slice(0, 50)}`)
        .join("|")
    };
    return JSON.stringify(cacheKeyData);
  }

  private getCachedResponse(context: RoomContext): AgentResponse | null {
    const key = this.generateCacheKey(context);
    const cached = this.responseCache.get(key);

    if (!cached) return null;

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
    const cachedResponse = this.getCachedResponse(context);
    if (cachedResponse) {
      return cachedResponse;
    }

    const system = buildDiscussionSystemPrompt({
      agentName: this.name,
      role: context.role,
      rules: context.rules,
      styleLine: this.styleLine,
      includeTaskLine: `Task: ${context.task}`,
      includePhaseLine: `Phase: ${context.phase}`,
      enableSentimentAnalysis: Boolean(context.enableSentimentAnalysis)
    });

    const isSlowModelMode = this.responseMode === "slow_model";
    const latest = formatTimeline(context.timeline, isSlowModelMode ? 5 : 8);
    const actionable = formatActionableEvents(
      isSlowModelMode ? (context.actionableEvents || []).slice(-4) : context.actionableEvents
    );
    let finalPrompt = buildDiscussionUserPrompt({
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
      const initialMaxTokens = isSlowModelMode
        ? Math.max(128, Math.min(this.maxOutputTokens, 420))
        : this.maxOutputTokens;
      const initialTimeoutMs = isSlowModelMode ? Math.max(this.timeoutMs, 120_000) : this.timeoutMs;
      response = await this.executeRequest(system, finalPrompt, initialMaxTokens, initialTimeoutMs);
    } catch (error: any) {
      if (this.isTimeoutError(error)) {
        const compactTimeline = formatTimeline(context.timeline, 4);
        const compactActionable = formatActionableEvents((context.actionableEvents || []).slice(-3));
        finalPrompt = buildDiscussionUserPrompt({
          task: context.task,
          phase: context.phase,
          contextVersion: context.contextVersion,
          contextSummary: context.contextSummary,
          actionableText: compactActionable,
          timelineText: compactTimeline,
          timelineLabel: "Compact timeline"
        });
        const reducedMaxTokens = Math.max(128, Math.min(this.maxOutputTokens, 420));
        const retryTimeoutMs = Math.max(this.timeoutMs, isSlowModelMode ? 180_000 : 120_000);
        console.warn(
          `[${this.name}] primary request timed out (${this.timeoutMs}ms), retrying with compact context and max_tokens=${reducedMaxTokens}`
        );
        response = await this.executeRequest(system, finalPrompt, reducedMaxTokens, retryTimeoutMs);
      } else {
        traceNodeModelError(
          {
            adapter: this.name,
            model: this.modelId,
            transport: "local",
            roomId: context.roomId,
            role: context.role,
            phase: context.phase,
            prompt: {
              format: "system-user",
              system,
              user: finalPrompt
            }
          },
          error
        );
        throw error;
      }
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${this.name} call failed (${response.status}): ${body}`);
    }

    const rawText = await this.extractTextFromResponse(response);
    if (!rawText) {
      traceNodeModelError(
        {
          adapter: this.name,
          model: this.modelId,
          transport: "local",
          roomId: context.roomId,
          role: context.role,
          phase: context.phase,
          prompt: {
            format: "system-user",
            system,
            user: finalPrompt
          }
        },
        new Error(`${this.name} returned an empty response`)
      );
      throw new Error(`${this.name} returned an empty response`);
    }

    traceNodeModelSuccess({
      adapter: this.name,
      model: this.modelId,
      transport: "local",
      roomId: context.roomId,
      role: context.role,
      phase: context.phase,
      prompt: {
        format: "system-user",
        system,
        user: finalPrompt
      },
      response: rawText
    });

    const parsed = parseStructuredAgentResponse(rawText);

    const result: AgentResponse = {
      text: parsed.text,
      confidence: inferConfidence(parsed.text, context.phase)
    };
    if (parsed.step1Envelope) {
      result.step1Envelope = parsed.step1Envelope;
    }
    if (context.enableSentimentAnalysis) {
      result.sentiment = parsed.sentiment;
    }

    this.setCachedResponse(context, result);

    return result;
  }

  async estimateCost(context: RoomContext, responseText = ""): Promise<CostEstimate> {
    return estimateCostWithUsageFallback(this.modelId, context, responseText);
  }

  protected isTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || "");
    return /timed out/i.test(message);
  }

  /**
   * Execute API request to the local model server.
   * Subclasses implement this with their specific API format.
   */
  protected abstract executeRequest(
    system: string,
    prompt: string,
    maxTokens: number,
    timeoutMs: number
  ): Promise<Response>;

  /**
   * Extract text content from the API response.
   * Subclasses implement this with their specific response format.
   */
  protected abstract extractTextFromResponse(response: Response): Promise<string>;
}
