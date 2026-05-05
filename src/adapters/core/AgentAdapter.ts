import { Artifact, CostEstimate, RoomContext, Sentiment } from "../../protocol/types.js";

export type Step1ParseMode =
  | "preferred_json"
  | "minimal_json"
  | "raw_fallback"
  | "parse_failed";

export interface Step1Claim {
  text: string;
}

export interface Step1Envelope {
  parseMode: Step1ParseMode;
  fullText: string;
  summary?: string;
  intent?: string;
  claims?: Step1Claim[];
}

export interface AgentResponse {
  text: string;
  confidence: number;
  sentiment?: Sentiment;
  artifacts?: Artifact[];
  pythonCode?: string;
  needHuman?: boolean;
  metadata?: Record<string, unknown>;
  step1Envelope?: Step1Envelope;
}

export interface AgentAdapter {
  name: string;
  modelId?: string;
  baseUrl?: string;
  capabilities: string[];
  supportedRoles: string[];
  concurrencyLimit?: number;
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

export interface ParsedStructuredResponse extends ParsedResponse {
  step1Envelope?: Step1Envelope;
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

function extractJsonCandidate(text: string): string | null {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatches = Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi));
  for (const match of fencedMatches) {
    const candidate = String(match[1] || "").trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      return candidate;
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1).trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      return candidate;
    }
  }

  return null;
}

function normalizeStep1Claims(value: unknown): Step1Claim[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((claim) => {
      if (typeof claim === "string") {
        return { text: claim.trim() };
      }
      if (claim && typeof claim === "object" && "text" in claim) {
        return { text: String((claim as { text?: unknown }).text || "").trim() };
      }
      return null;
    })
    .filter((claim): claim is Step1Claim => Boolean(claim?.text));
}

function parseStep1EnvelopeFromJsonCandidate(candidate: string | null): Step1Envelope | null {
  if (!candidate) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const fullText = String(record.full_text ?? record.fullText ?? "").trim();
  if (!fullText) {
    return null;
  }

  const summary = String(record.summary ?? "").trim();
  const intent = String(record.intent ?? "").trim();
  const claims = normalizeStep1Claims(record.claims);

  return {
    parseMode: summary && intent ? "preferred_json" : "minimal_json",
    fullText,
    ...(summary ? { summary } : {}),
    ...(intent ? { intent } : {}),
    ...(claims.length ? { claims } : {})
  };
}

function isStructuredLabel(line: string): boolean {
  return /^(full[_ ]?text|summary|intent|claims)\s*:/i.test(line.trim());
}

function parseStep1EnvelopeFromLabeledText(text: string): Step1Envelope | null {
  const lines = String(text || "").split(/\r?\n/);
  let currentField: "full_text" | "summary" | "intent" | "claims" | null = null;
  const fullTextLines: string[] = [];
  const summaryLines: string[] = [];
  const intentLines: string[] = [];
  const claims: Step1Claim[] = [];

  const pushClaim = (value: string): void => {
    const normalized = value.replace(/^[-*•]\s*/, "").trim();
    if (normalized) {
      claims.push({ text: normalized });
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const fieldMatch = /^(full[_ ]?text|summary|intent|claims)\s*:\s*(.*)$/i.exec(line);
    if (fieldMatch) {
      const field = fieldMatch[1].toLowerCase().replace(/\s+/g, "_");
      const value = String(fieldMatch[2] || "").trim();
      if (field === "full_text") {
        currentField = "full_text";
        if (value) fullTextLines.push(value);
      } else if (field === "summary") {
        currentField = "summary";
        if (value) summaryLines.push(value);
      } else if (field === "intent") {
        currentField = "intent";
        if (value) intentLines.push(value);
      } else if (field === "claims") {
        currentField = "claims";
        if (value) pushClaim(value);
      }
      continue;
    }

    if (currentField === "claims" && /^[-*•]\s+/.test(line)) {
      pushClaim(line);
      continue;
    }

    if (isStructuredLabel(line)) {
      currentField = null;
      continue;
    }

    if (currentField === "full_text") {
      fullTextLines.push(line);
    } else if (currentField === "summary") {
      summaryLines.push(line);
    } else if (currentField === "intent") {
      intentLines.push(line);
    }
  }

  const fullText = fullTextLines.join(" ").trim();
  if (!fullText) {
    return null;
  }

  const summary = summaryLines.join(" ").trim();
  const intent = intentLines.join(" ").trim();
  return {
    parseMode: summary && intent ? "preferred_json" : "minimal_json",
    fullText,
    ...(summary ? { summary } : {}),
    ...(intent ? { intent } : {}),
    ...(claims.length ? { claims } : {})
  };
}

function parseStep1EnvelopeFromText(text: string): Step1Envelope | null {
  const fromJson = parseStep1EnvelopeFromJsonCandidate(extractJsonCandidate(text));
  if (fromJson) {
    return fromJson;
  }

  return parseStep1EnvelopeFromLabeledText(text);
}

export function parseStructuredAgentResponse(raw: string): ParsedStructuredResponse {
  const parsed = parseSentimentFromResponse(raw);
  const step1Envelope = parseStep1EnvelopeFromText(parsed.text);

  if (!step1Envelope) {
    return parsed;
  }

  return {
    text: step1Envelope.fullText,
    sentiment: parsed.sentiment,
    step1Envelope
  };
}
