import { describe, expect, it } from "vitest";
import { evaluateRoomAgentPolicy } from "../src/core/RoomAgentPolicy.js";
import { CoreRoomMessage } from "../src/protocol/types.js";

function buildMessage(overrides: Partial<CoreRoomMessage> = {}): CoreRoomMessage {
  return {
    id: "message-1",
    timestamp: "2026-04-08T00:00:00Z",
    from: "human",
    to: "room",
    scope: "room",
    type: "chat",
    text: "Please review this plan.",
    ...overrides
  };
}

describe("RoomAgentPolicy", () => {
  it("responds to direct messages addressed to the adapter", () => {
    const decision = evaluateRoomAgentPolicy({
      candidate: buildMessage({
        scope: "direct",
        to: "fake-agent",
        text: "Need your answer"
      }),
      adapterName: "fake-agent"
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe("direct message to this agent");
    expect(decision.triggeredBy).toBe("message-1");
  });

  it("responds to room messages that explicitly mention the agent", () => {
    const decision = evaluateRoomAgentPolicy({
      candidate: buildMessage({
        from: "peer-agent",
        text: "@fake-agent can you sanity-check this assumption?"
      }),
      adapterName: "fake-agent"
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe("room message explicitly mentions this agent");
  });

  it("responds to room-wide requests from the human operator", () => {
    const decision = evaluateRoomAgentPolicy({
      candidate: buildMessage({
        from: "human",
        intent: "request_review",
        text: "Please review the tradeoffs and call out the risks."
      }),
      adapterName: "fake-agent",
      roomPhase: "independent_answers",
      roomRole: "researcher"
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe("independent answers phase ignores broad critique request");
  });

  it("allows review requests in independent answers for reviewer roles", () => {
    const decision = evaluateRoomAgentPolicy({
      candidate: buildMessage({
        from: "human",
        intent: "request_review",
        text: "Please review the tradeoffs and call out the risks."
      }),
      adapterName: "fake-agent",
      roomPhase: "independent_answers",
      roomRole: "skeptic"
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe("independent answers review request for reviewer role");
  });

  it("allows synthesis-phase review requests", () => {
    const decision = evaluateRoomAgentPolicy({
      candidate: buildMessage({
        from: "human",
        intent: "request_review",
        text: "Please review the final draft and call out any remaining risks."
      }),
      adapterName: "fake-agent",
      roomPhase: "synthesis",
      roomRole: "skeptic"
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe("synthesis phase review request");
  });

  it("blocks broad synthesis-phase planning requests", () => {
    const decision = evaluateRoomAgentPolicy({
      candidate: buildMessage({
        from: "human",
        intent: "request_plan",
        text: "Can someone propose the next execution plan?"
      }),
      adapterName: "fake-agent",
      roomPhase: "synthesis",
      roomRole: "researcher"
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe("synthesis phase ignores broad room request");
  });

  it("allows broad critique requests during cross critique", () => {
    const decision = evaluateRoomAgentPolicy({
      candidate: buildMessage({
        from: "human",
        intent: "request_critique",
        text: "Challenge the draft and identify weak assumptions."
      }),
      adapterName: "fake-agent",
      roomPhase: "cross_critique",
      roomRole: "researcher"
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe("cross critique request during autonomous session");
  });

  it("blocks broad planning requests during cross critique", () => {
    const decision = evaluateRoomAgentPolicy({
      candidate: buildMessage({
        from: "human",
        intent: "request_plan",
        text: "Can someone propose a fresh execution plan?"
      }),
      adapterName: "fake-agent",
      roomPhase: "cross_critique",
      roomRole: "researcher"
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe("cross critique phase ignores broad planning request");
  });

  it("blocks broad room requests during human gate", () => {
    const decision = evaluateRoomAgentPolicy({
      candidate: buildMessage({
        from: "human",
        intent: "request_review",
        text: "Anyone want one more pass before approval?"
      }),
      adapterName: "fake-agent",
      roomPhase: "human_gate",
      roomRole: "skeptic"
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe("human gate waits for explicit human approval");
  });

  it("ignores passive orchestrator room updates", () => {
    const decision = evaluateRoomAgentPolicy({
      candidate: buildMessage({
        from: "orchestrator",
        intent: "merge_best_parts_and_risks",
        text: "System event: merging outputs."
      }),
      adapterName: "fake-agent"
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe("passive room intent");
  });

  it("ignores peer room chatter that does not target this agent", () => {
    const decision = evaluateRoomAgentPolicy({
      candidate: buildMessage({
        from: "peer-agent",
        text: "I think we should compare two alternatives before synthesis."
      }),
      adapterName: "fake-agent"
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe("room message not targeted to this agent");
  });

  it("respects room cooldown for repeated room-wide requests", () => {
    const decision = evaluateRoomAgentPolicy({
      candidate: buildMessage({
        id: "message-2",
        from: "human",
        intent: "request_feedback",
        text: "Can someone validate the latest draft?"
      }),
      adapterName: "fake-agent",
      lastRespondedAt: 1_000,
      now: 5_000,
      cooldownMs: 10_000
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe("room cooldown active");
  });
});