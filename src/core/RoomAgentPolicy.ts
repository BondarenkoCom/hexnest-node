import { CoreRoomMessage } from "../protocol/types.js";

export interface RoomAgentPolicyInput {
  candidate: CoreRoomMessage;
  adapterName: string;
  joinedAgentName?: string | null;
  roomPhase?: string | null;
  roomRole?: string | null;
  lastRespondedMessageId?: string | null;
  lastRespondedAt?: number | null;
  now?: number;
  cooldownMs?: number;
}

export interface RoomAgentPolicyDecision {
  shouldRespond: boolean;
  reason: string;
  triggeredBy?: string;
}

type RoomRequestKind = "proposal" | "critique" | "synthesis" | "decision" | "general";

type RoleAffinity = "planning" | "review" | "synthesis" | "general";

export const DEFAULT_ROOM_RESPONSE_COOLDOWN_MS = 15_000;

const ROOM_WIDE_REQUEST_INTENTS = new Set([
  "ask_room",
  "request_input",
  "request_feedback",
  "request_review",
  "request_plan",
  "request_critique",
  "request_analysis",
  "call_for_input",
  "need_help",
  "need_human",
  "summon_agent",
  "escalate"
]);

const PASSIVE_ROOM_INTENTS = new Set([
  "noop",
  "heartbeat",
  "presence",
  "agent_joined",
  "agent_left",
  "status_update",
  "finalize_room",
  "merge_best_parts_and_risks"
]);

const SYNTHESIS_REVIEW_INTENTS = new Set([
  "request_review",
  "request_feedback",
  "request_critique",
  "need_help",
  "need_human",
  "escalate"
]);

const PROPOSAL_REQUEST_INTENTS = new Set([
  "ask_room",
  "request_input",
  "request_plan",
  "request_analysis",
  "call_for_input",
  "summon_agent"
]);

const DECISION_REQUEST_INTENTS = new Set([
  "need_human",
  "escalate",
  "finalize_room"
]);

export function evaluateRoomAgentPolicy(input: RoomAgentPolicyInput): RoomAgentPolicyDecision {
  const candidate = input.candidate;
  const adapterName = String(input.adapterName || "").trim();
  const joinedAgentName = String(input.joinedAgentName || "").trim();
  const roomPhase = String(input.roomPhase || "open_room").trim().toLowerCase();
  const roomRole = String(input.roomRole || "").trim().toLowerCase();
  const lastRespondedMessageId = String(input.lastRespondedMessageId || "").trim();
  const lastRespondedAt = Number(input.lastRespondedAt || 0);
  const now = Number(input.now || Date.now());
  const cooldownMs = Math.max(0, Number(input.cooldownMs ?? DEFAULT_ROOM_RESPONSE_COOLDOWN_MS));

  if (!candidate?.id) {
    return { shouldRespond: false, reason: "candidate has no id" };
  }

  if (String(candidate.type || "chat").toLowerCase() === "system") {
    return { shouldRespond: false, reason: "system message" };
  }

  const sender = String(candidate.from || "").trim();
  if (!sender) {
    return { shouldRespond: false, reason: "message has no sender" };
  }

  if (sender === adapterName || (joinedAgentName && sender === joinedAgentName)) {
    return { shouldRespond: false, reason: "self message" };
  }

  if (candidate.id === lastRespondedMessageId) {
    return { shouldRespond: false, reason: "already responded to this message" };
  }

  if (candidate.triggeredBy && candidate.triggeredBy === lastRespondedMessageId) {
    return { shouldRespond: false, reason: "looped follow-up to last response" };
  }

  const explicitRoomMention = isExplicitAgentMention(candidate, adapterName, joinedAgentName);
  const scope = candidate.scope === "direct" ? "direct" : "room";
  if (scope === "direct") {
    const target = String(candidate.to || "").trim();
    if (!target) {
      return { shouldRespond: false, reason: "direct message without target" };
    }
    if (target !== adapterName && (!joinedAgentName || target !== joinedAgentName)) {
      return { shouldRespond: false, reason: "direct message for another agent" };
    }

    return {
      shouldRespond: true,
      reason: "direct message to this agent",
      triggeredBy: candidate.id
    };
  }

  if (explicitRoomMention) {
    return {
      shouldRespond: true,
      reason: "room message explicitly mentions this agent",
      triggeredBy: candidate.id
    };
  }

  if (isPassiveRoomIntent(candidate.intent)) {
    return { shouldRespond: false, reason: "passive room intent" };
  }

  if (!isRoomWideRequest(candidate)) {
    return { shouldRespond: false, reason: "room message not targeted to this agent" };
  }

  const phaseDecision = evaluatePhaseRules(candidate, roomPhase, roomRole);
  if (!phaseDecision.allowed) {
    return { shouldRespond: false, reason: phaseDecision.reason };
  }

  if (lastRespondedAt > 0 && now - lastRespondedAt < cooldownMs) {
    return { shouldRespond: false, reason: "room cooldown active" };
  }

  return {
    shouldRespond: true,
    reason: phaseDecision.reason,
    triggeredBy: candidate.id
  };
}

function evaluatePhaseRules(
  candidate: CoreRoomMessage,
  roomPhase: string,
  roomRole: string
): { allowed: boolean; reason: string } {
  const normalizedPhase = normalizePhase(roomPhase);
  const requestKind = classifyRoomRequest(candidate);
  const roleAffinity = inferRoleAffinity(roomRole);

  if (normalizedPhase === "human_gate") {
    if (requestKind === "decision") {
      return { allowed: false, reason: "human gate waits for explicit human approval" };
    }
    return { allowed: false, reason: "human gate ignores broad room requests" };
  }

  if (normalizedPhase === "synthesis") {
    if (isSynthesisReviewRequest(candidate, roomRole)) {
      return { allowed: true, reason: "synthesis phase review request" };
    }
    if (requestKind === "synthesis" && roleAffinity !== "planning") {
      return { allowed: true, reason: "synthesis phase finalization request" };
    }
    return { allowed: false, reason: "synthesis phase ignores broad room request" };
  }

  if (normalizedPhase === "cross_critique") {
    if (requestKind === "critique" || requestKind === "synthesis") {
      return { allowed: true, reason: "cross critique request during autonomous session" };
    }
    if (requestKind === "general" && roleAffinity === "review") {
      return { allowed: true, reason: "cross critique review request for reviewer role" };
    }
    return { allowed: false, reason: "cross critique phase ignores broad planning request" };
  }

  if (normalizedPhase === "independent_answers") {
    if (requestKind === "proposal" || requestKind === "general") {
      return { allowed: true, reason: "independent answers request during autonomous session" };
    }
    if (requestKind === "critique" && roleAffinity === "review") {
      return { allowed: true, reason: "independent answers review request for reviewer role" };
    }
    return { allowed: false, reason: "independent answers phase ignores broad critique request" };
  }

  if (normalizedPhase === "open_room") {
    if (requestKind === "decision") {
      return { allowed: false, reason: "open room phase ignores broad escalation request" };
    }
    return { allowed: true, reason: "open room request during autonomous session" };
  }

  return { allowed: true, reason: "room request during autonomous session" };
}

function normalizePhase(roomPhase: string): string {
  const normalized = String(roomPhase || "open_room").trim().toLowerCase();

  if (normalized.includes("human_gate") || normalized.includes("approval")) {
    return "human_gate";
  }
  if (normalized.includes("synthesis") || normalized.includes("verdict") || normalized.includes("final")) {
    return "synthesis";
  }
  if (
    normalized.includes("cross")
    || normalized.includes("critique")
    || normalized.includes("attack")
    || normalized.includes("rebuttal")
    || normalized.includes("defense")
  ) {
    return "cross_critique";
  }
  if (normalized.includes("independent") || normalized.includes("presentation")) {
    return "independent_answers";
  }
  return "open_room";
}

function isPassiveRoomIntent(intent: string | undefined): boolean {
  const normalized = String(intent || "").trim().toLowerCase();
  return Boolean(normalized && PASSIVE_ROOM_INTENTS.has(normalized));
}

function isRoomWideRequest(candidate: CoreRoomMessage): boolean {
  const sender = String(candidate.from || "").trim().toLowerCase();
  const intent = String(candidate.intent || "").trim().toLowerCase();
  const text = String(candidate.text || "").trim();

  if (sender === "human" || sender === "orchestrator") {
    if (ROOM_WIDE_REQUEST_INTENTS.has(intent)) {
      return true;
    }
    return /\?|\b(can|could|should|please|need|help|review|check|analyze|analyse|critique|summarize|summarise|plan)\b/i.test(
      text
    );
  }

  return false;
}

function classifyRoomRequest(candidate: CoreRoomMessage): RoomRequestKind {
  const intent = String(candidate.intent || "").trim().toLowerCase();
  const text = String(candidate.text || "").trim();

  if (DECISION_REQUEST_INTENTS.has(intent) || isDecisionLikeText(text)) {
    return "decision";
  }
  if (SYNTHESIS_REVIEW_INTENTS.has(intent) || isCritiqueLikeText(text)) {
    return "critique";
  }
  if (isSynthesisLikeIntent(intent) || isSynthesisLikeText(text)) {
    return "synthesis";
  }
  if (PROPOSAL_REQUEST_INTENTS.has(intent) || isProposalLikeText(text)) {
    return "proposal";
  }
  return "general";
}

function inferRoleAffinity(roomRole: string): RoleAffinity {
  const normalized = String(roomRole || "").trim().toLowerCase();
  if (!normalized) {
    return "general";
  }
  if (/\b(skeptic|review|reviewer|critic|qa|risk|audit|security|validator|compliance|challenger)\b/i.test(normalized)) {
    return "review";
  }
  if (/\b(synth|lead|editor|final|arbiter|judge|moderator)\b/i.test(normalized)) {
    return "synthesis";
  }
  if (/\b(planner|strategy|research|analyst|writer|builder|implementer|executor)\b/i.test(normalized)) {
    return "planning";
  }
  return "general";
}

function isSynthesisReviewRequest(candidate: CoreRoomMessage, roomRole: string): boolean {
  const intent = String(candidate.intent || "").trim().toLowerCase();
  const text = String(candidate.text || "").trim();
  const reviewLikeText = /\b(review|critique|check|verify|validate|risk|final|merge|synthesize|synthesise|challenge)\b/i.test(
    text
  );
  const roleAffinity = inferRoleAffinity(roomRole);
  const reviewLikeRole = roleAffinity === "review" || roleAffinity === "synthesis";

  if (SYNTHESIS_REVIEW_INTENTS.has(intent)) {
    return true;
  }

  return reviewLikeText || reviewLikeRole;
}

function isCritiqueLikeText(text: string): boolean {
  return /\b(review|feedback|critique|challenge|stress[-\s]?test|risk|verify|validate|sanity[-\s]?check|check)\b/i.test(text);
}

function isProposalLikeText(text: string): boolean {
  return /\b(plan|propose|proposal|analyze|analyse|outline|approach|strategy|break down|next step|options?)\b/i.test(text);
}

function isSynthesisLikeIntent(intent: string): boolean {
  return /synth|merge|final|verdict/.test(intent);
}

function isSynthesisLikeText(text: string): boolean {
  return /\b(synthesize|synthesise|merge|final draft|final answer|final output|verdict|combine)\b/i.test(text);
}

function isDecisionLikeText(text: string): boolean {
  return /\b(approve|approval|human gate|sign off|sign-off|finalize|finalise|escalate)\b/i.test(text);
}

function isExplicitAgentMention(
  candidate: CoreRoomMessage,
  adapterName: string,
  joinedAgentName: string
): boolean {
  const text = String(candidate.text || "").trim();
  if (!text) {
    return false;
  }

  return [adapterName, joinedAgentName].some((name) => {
    const normalized = String(name || "").trim();
    if (!normalized) {
      return false;
    }
    return buildMentionPattern(normalized).test(text);
  });
}

function buildMentionPattern(name: string): RegExp {
  const escaped = escapeRegExp(name).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])(@?${escaped})([^a-z0-9]|$)`, "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}