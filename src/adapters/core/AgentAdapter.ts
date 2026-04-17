import { Artifact, CostEstimate, RoomContext, Sentiment } from "../../protocol/types.js";

export interface AgentResponse {
  text: string;
  confidence: number;
  sentiment?: Sentiment;
  artifacts?: Artifact[];
  pythonCode?: string;
  needHuman?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentAdapter {
  name: string;
  modelId?: string;
  baseUrl?: string;
  capabilities: string[];
  supportedRoles: string[];
  respond(context: RoomContext): Promise<AgentResponse>;
  estimateCost(context: RoomContext, responseText?: string): Promise<CostEstimate>;
}

const MODEL_PRICING_PER_1M: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-5-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4o": { inputPer1M: 5, outputPer1M: 15 },
  "claude-3-7-sonnet-latest": { inputPer1M: 3, outputPer1M: 15 },
  "claude-3-5-sonnet-latest": { inputPer1M: 3, outputPer1M: 15 },
  "grok-4-1-fast": { inputPer1M: 2, outputPer1M: 10 },
  "grok-3": { inputPer1M: 3, outputPer1M: 15 },
  "gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5 },
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10 }
};

export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

export function estimateUsdFromModel(
  modelId: string | undefined,
  inputTokens: number,
  outputTokens: number
): number {
  const key = String(modelId || "").trim().toLowerCase();
  const pricing = MODEL_PRICING_PER_1M[key];
  if (!pricing) {
    return 0;
  }
  const cost =
    (Math.max(0, inputTokens) / 1_000_000) * pricing.inputPer1M +
    (Math.max(0, outputTokens) / 1_000_000) * pricing.outputPer1M;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function inferConfidence(text: string, phase: string): number {
  const content = String(text || "").trim();
  const normalized = content.toLowerCase();
  let score = 0.72;

  if (phase === "synthesis") score += 0.08;
  if (content.length < 120) score -= 0.12;
  if (content.length > 700) score += 0.04;

  const hedgingPattern = /\b(i\s*am\s*not\s*sure|i'm\s*not\s*sure|not\s*sure|it\s*depends|maybe|uncertain|can't\s*verify|cannot\s*verify|lack\s*data)\b/i;
  if (hedgingPattern.test(normalized)) score -= 0.18;

  const evidencePattern = /\b(data|evidence|metric|source|because|therefore|probability)\b/i;
  if (evidencePattern.test(normalized)) score += 0.06;

  const clamped = Math.min(0.95, Math.max(0.35, score));
  return Math.round(clamped * 100) / 100;
}

const VALID_SENTIMENT_LABELS = [
  "hostile",
  "skeptical",
  "neutral",
  "concerned",
  "encouraging",
  "confident"
] as const;

type SentimentLabel = typeof VALID_SENTIMENT_LABELS[number];
const SENTIMENT_SCORE_BY_LABEL: Record<SentimentLabel, number> = {
  hostile: -0.85,
  skeptical: -0.35,
  neutral: 0,
  concerned: -0.2,
  encouraging: 0.45,
  confident: 0.75
};

export interface ParsedResponse {
  text: string;
  sentiment: Sentiment;
}

/**
 * Parse [SENTIMENT: label] tag from LLM response.
 * Returns cleaned text and extracted sentiment object.
 */
export function parseSentimentFromResponse(raw: string): ParsedResponse {
  const trimmed = String(raw || "").trim();
  const match = /^\[SENTIMENT:\s*([a-z_]+)\]\s*(.*)$/is.exec(trimmed);

  if (match) {
    const labelRaw = match[1].toLowerCase() as SentimentLabel;
    const text = match[2].trim();
    const label = VALID_SENTIMENT_LABELS.includes(labelRaw) ? labelRaw : "neutral";
    return {
      text,
      sentiment: {
        label,
        score: SENTIMENT_SCORE_BY_LABEL[label]
      }
    };
  }

  // Fallback: no sentiment tag found, use neutral.
  return {
    text: trimmed,
    sentiment: {
      label: "neutral",
      score: 0
    }
  };
}
