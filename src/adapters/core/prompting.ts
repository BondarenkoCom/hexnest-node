import { RoomContext } from "../../protocol/types.js";

export function roleDebateTone(role: string): string {
  const normalized = String(role || "").trim().toLowerCase();
  if (/skeptic|critic|review|reviewer|breaker|qa|risk|audit|security|validator/.test(normalized)) {
    return "Tone: adversarial review. Stress-test assumptions, prioritize failure modes, and challenge weak evidence.";
  }
  if (/builder|implementer|executor|engineer|developer/.test(normalized)) {
    return "Tone: constructive implementation. Turn ideas into concrete steps, constraints, and trade-offs.";
  }
  if (/research|analyst|investigator/.test(normalized)) {
    return "Tone: analytical research. Compare alternatives, cite signals from context, and separate fact from inference.";
  }
  if (/synth|arbiter|judge|lead|moderator|final/.test(normalized)) {
    return "Tone: synthesis and arbitration. Weigh competing arguments fairly and converge on a balanced position.";
  }
  return "Tone: collaborative debate. Provide clear claims, evidence, and at least one counterpoint.";
}

export function liveDiscussionGuidance(): string[] {
  return [
    "Participate as a live collaborator in an ongoing discussion, not as a final summary bot.",
    "Write like a direct chat/thread reply to peers, not like a document or executive brief.",
    "Use plain text conversational style. Avoid markdown headings, bold section labels, bullet lists, and numbered lists unless the user explicitly asks for them.",
    "Do not use report sections or labels such as Claim, Evidence, Counterpoint, Conclusion, Summary, or Follow-up Question.",
    "Prefer 1-3 short paragraphs with natural transitions over heading-based structure.",
    "Start with your core stance in one sentence, then support it naturally in the same flow.",
    "State claims with evidence from room context, timeline, or artifacts.",
    "Include at least one counterargument, caveat, or risk check before concluding.",
    "Ask at most one focused follow-up question only when key assumptions are missing.",
    "Do not force DECIDE/ACT/REPORT formatting unless explicitly requested by the room."
  ];
}

export function structuredOutputGuidance(): string[] {
  return [
    "STEP 2 OUTPUT PREFERENCE:",
    "When you can do it reliably, structure your reply around these fields: full_text, summary, intent, and optional claims.",
    "full_text should contain the complete room-visible answer in normal prose.",
    "summary should be a short compact restatement of the same answer.",
    "intent should be a short label for the move you are making, such as propose, critique, question, agree, disagree, refine, or unknown.",
    "claims is optional and should stay minimal; omit it when you are not confident.",
    "If you cannot produce a stable structured answer, fall back to a normal plain-text reply instead of inventing fields."
  ];
}

function normalizeClaims(claims: RoomContext["timeline"][number]["claims"]): string[] {
  if (!Array.isArray(claims)) {
    return [];
  }

  return claims
    .map((claim) => {
      if (typeof claim === "string") {
        return claim.trim();
      }
      if (claim && typeof claim === "object" && "text" in claim) {
        return String(claim.text || "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

function formatCompactMetadata(event: RoomContext["timeline"][number]): string {
  const parts: string[] = [];

  if (event.summary) {
    parts.push(`summary=${event.summary}`);
  }

  const claims = normalizeClaims(event.claims);
  if (claims.length) {
    parts.push(`claims=${claims.join(" | ")}`);
  }

  return parts.length ? ` {${parts.join("; ")}}` : "";
}

function formatRecentCompact(item: NonNullable<RoomContext["recentCompacts"]>[number]): string {
  const parts: string[] = [];

  if (item.summary) {
    parts.push(`summary=${item.summary}`);
  }

  const claims = normalizeClaims(item.claims);
  if (claims.length) {
    parts.push(`claims=${claims.join(" | ")}`);
  }

  parts.push(`intent=${item.intent}`);
  parts.push(`source=${item.representationSource}`);
  return `- ${item.messageId}${parts.length ? ` {${parts.join("; ")}}` : ""}`;
}

export function formatRecentCompacts(recentCompacts: RoomContext["recentCompacts"], limit = 5): string {
  const items = (recentCompacts || []).slice(-limit);
  if (!items.length) {
    return "";
  }

  return items.map((item) => formatRecentCompact(item)).join("\n");
}

export function formatTimeline(timeline: RoomContext["timeline"], limit = 10): string {
  return timeline
    .slice(-limit)
    .map((event) => {
      const meta = [event.scope, event.type, event.intent].filter(Boolean).join("/");
      const trigger = event.triggeredBy ? ` trig=${event.triggeredBy}` : "";
      const sentiment = event.sentiment ? ` [mood:${event.sentiment.label}]` : "";
      const compact = formatCompactMetadata(event);
      return `${event.from} -> ${event.to} [${meta || "chat"}]${trigger}${sentiment}: ${event.text}${compact}`;
    })
    .join("\n");
}

export function formatActionableEvents(actionableEvents: RoomContext["actionableEvents"]): string {
  return (actionableEvents || [])
    .map((event) => {
      const meta = [event.scope, event.type, event.intent].filter(Boolean).join("/");
      const compact = formatCompactMetadata(event);
      return `- ${event.from} -> ${event.to} [${meta || "chat"}]${event.triggeredBy ? ` trig=${event.triggeredBy}` : ""}: ${event.text}${compact}`;
    })
    .join("\n");
}

export function buildDiscussionSystemPrompt(options: {
  agentName: string;
  role: string;
  rules: string;
  styleLine: string;
  includeTaskLine?: string;
  includePhaseLine?: string;
  enableSentimentAnalysis?: boolean;
}): string {
  const base = [
    `You are ${options.agentName} in HexNest room.`,
    `Assigned role: ${options.role}.`,
    roleDebateTone(options.role),
    ...(options.includeTaskLine ? [options.includeTaskLine] : []),
    ...(options.includePhaseLine ? [options.includePhaseLine] : []),
    `Rules: ${options.rules}`,
    options.styleLine,
    ...liveDiscussionGuidance(),
    ...structuredOutputGuidance()
  ];

  if (options.enableSentimentAnalysis) {
    base.push("SENTIMENT OUTPUT REQUIREMENT:");
    base.push("You MUST start your response with a sentiment tag in this exact format: [SENTIMENT: label]");
    base.push("Available sentiment labels: hostile, skeptical, neutral, concerned, encouraging, confident");
    base.push("Choose the sentiment that best reflects your stance and tone in this response.");
    base.push("Example: [SENTIMENT: skeptical]\nYour actual response text here...");
  }

  return base.join("\n");
}

export function buildDiscussionUserPrompt(options: {
  task: string;
  phase: string;
  contextVersion?: string;
  contextSummary?: string;
  recentCompactsText?: string;
  actionableText: string;
  timelineText: string;
  timelineLabel?: string;
}): string {
  const timelineLabel = options.timelineLabel || "Timeline";
  return [
    `Task: ${options.task}`,
    `Phase: ${options.phase}`,
    `ContextVersion: ${options.contextVersion || "v1"}`,
    `Summary: ${options.contextSummary || "n/a"}`,
    ...(options.recentCompactsText ? ["Recent compacts:", options.recentCompactsText] : []),
    "Actionable events:",
    options.actionableText || "(none)",
    `${timelineLabel}:`,
    options.timelineText || "(empty)"
  ].join("\n");
}
