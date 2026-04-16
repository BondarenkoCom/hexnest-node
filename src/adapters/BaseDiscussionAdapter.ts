import { AgentAdapter, AgentResponse, inferConfidence } from "./AgentAdapter.js";
import { CostEstimate, RoomContext } from "../protocol/types.js";
import { estimateCostWithUsageFallback, UsageSnapshot } from "./costing.js";
import {
  buildDiscussionSystemPrompt,
  buildDiscussionUserPrompt,
  formatActionableEvents,
  formatTimeline
} from "./prompting.js";

/**
 * Base abstract class for AgentAdapters that use text-based LLMs.
 * Removes boilerplate of building prompts, managing usage, and formatting capabilities.
 */
export abstract class BaseDiscussionAdapter implements AgentAdapter {
  public readonly name: string;
  public readonly modelId: string;
  public readonly capabilities: string[];
  public readonly supportedRoles: string[];
  public readonly baseUrl?: string;
  
  protected readonly model: string;
  protected lastUsage: UsageSnapshot = { input: 0, output: 0 };
  
  /**
   * The style instruction appended to the system prompt.
   */
  protected abstract readonly styleLine: string;

  constructor(
    options: {
      name: string;
      model: string;
      baseUrl?: string;
      capabilities?: string[];
      supportedRoles?: string[];
      defaultCapabilities: string[];
      defaultRoles: string[];
    }
  ) {
    this.name = options.name;
    this.model = options.model;
    this.modelId = this.model;
    this.baseUrl = options.baseUrl;
    this.capabilities = options.capabilities || options.defaultCapabilities;
    this.supportedRoles = options.supportedRoles || options.defaultRoles;
  }

  /**
   * Core workflow: formats prompts, asks subclass to make API call, and wraps response.
   */
  async respond(context: RoomContext): Promise<AgentResponse> {
    const systemPrompt = buildDiscussionSystemPrompt({
      agentName: this.name,
      role: context.role,
      rules: context.rules,
      styleLine: this.styleLine
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
      timelineLabel: this.getTimelineLabel()
    });

    const text = await this.executeCompletion(systemPrompt, userPrompt, context);

    if (!text) {
      throw new Error(`${this.constructor.name} returned an empty response`);
    }

    return {
      text,
      confidence: inferConfidence(text, context.phase)
    };
  }

  async estimateCost(context: RoomContext, responseText = ""): Promise<CostEstimate> {
    return estimateCostWithUsageFallback(this.modelId, context, responseText, this.lastUsage);
  }

  protected getTimelineLabel(): string | undefined {
    return undefined; // Can be overridden by subclasses (e.g. Claude uses "Recent messages")
  }

  /**
   * Subclasses must implement this to perform the actual network request or process call.
   * Implementation should update `this.lastUsage` internally before returning the text.
   */
  protected abstract executeCompletion(
    systemPrompt: string, 
    userPrompt: string, 
    context: RoomContext
  ): Promise<string>;
}
