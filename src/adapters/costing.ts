import { CostEstimate, RoomContext } from "../protocol/types.js";
import { estimateTokensFromText, estimateUsdFromModel } from "./AgentAdapter.js";

export interface UsageSnapshot {
  input: number;
  output: number;
}

interface NumericPathRule {
  inputPath: string;
  outputPath: string;
}

export function estimateCostWithUsageFallback(
  modelId: string,
  context: RoomContext,
  responseText = "",
  usage?: UsageSnapshot
): CostEstimate {
  if (usage && (usage.input > 0 || usage.output > 0)) {
    return {
      inputTokens: usage.input,
      outputTokens: usage.output,
      estimatedCostUsd: estimateUsdFromModel(modelId, usage.input, usage.output)
    };
  }

  const inputTokens = estimateTokensFromText(buildEstimateInputText(context));
  const outputTokens = estimateTokensFromText(responseText);
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateUsdFromModel(modelId, inputTokens, outputTokens)
  };
}

export function extractUsageSnapshot(
  payload: unknown,
  rule: NumericPathRule
): UsageSnapshot {
  return {
    input: Number(readPath(payload, rule.inputPath) || 0),
    output: Number(readPath(payload, rule.outputPath) || 0)
  };
}

function buildEstimateInputText(context: RoomContext): string {
  return [
    context.task,
    context.rules,
    context.timeline.map((event) => event.text).join("\n")
  ].join("\n");
}

function readPath(value: unknown, pathExpr: string): unknown {
  const segments = String(pathExpr || "").split(".").filter(Boolean);
  let current: unknown = value;
  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
