import { Artifact, CostEstimate, RoomContext } from "../../protocol/types.js";

export interface AgentResponse {
  text: string;
  confidence: number;
  emotion?: string;
  artifacts?: Artifact[];
  pythonCode?: string;
  needHuman?: boolean;
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

const VALID_EMOTIONS = [
  "neutral",
  "thinking",
  "surprised",
  "smirk",
  "annoyed",
  "arms_crossed",
  "hand_chin",
  "finger_up"
] as const;

export type EmotionLabel = typeof VALID_EMOTIONS[number];

export interface ParsedResponse {
  text: string;
  emotion: string;
}

/**
 * Parse [EMOTION: xxx] tag from LLM response.
 * Returns cleaned text and extracted emotion label.
 */
export function parseEmotionFromResponse(raw: string): ParsedResponse {
  const trimmed = String(raw || "").trim();
  const match = /^\[EMOTION:\s*(\w+)\]\s*(.*)$/is.exec(trimmed);
  
  if (match) {
    const emotionRaw = match[1].toLowerCase();
    const text = match[2].trim();
    const emotion = VALID_EMOTIONS.includes(emotionRaw as any) ? emotionRaw : "neutral";
    return { text, emotion };
  }
  
  // Fallback: no emotion tag found, use neutral
  return { text: trimmed, emotion: "neutral" };
}


