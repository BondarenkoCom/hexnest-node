import { describe, expect, it, vi } from "vitest";
import { BaseDiscussionAdapter } from "../../src/adapters/core/BaseDiscussionAdapter.js";
import { UsageSnapshot } from "../../src/adapters/core/costing.js";

// Create a concrete implementation for testing
class TestDiscussionAdapter extends BaseDiscussionAdapter {
  protected readonly styleLine = "Be concrete and simple.";

  public mockResponse = "Test response";
  public mockUsage: UsageSnapshot = { input: 10, output: 20 };
  public executeCompletionCalls: { system: string; user: string }[] = [];

  constructor() {
    super({
      name: "test-adapter",
      model: "test-model",
      defaultCapabilities: ["test"],
      defaultRoles: ["test-role"],
    });
  }

  protected async executeCompletion(systemPrompt: string, userPrompt: string): Promise<string> {
    this.executeCompletionCalls.push({ system: systemPrompt, user: userPrompt });
    this.lastUsage = this.mockUsage;
    return this.mockResponse;
  }
}

describe("BaseDiscussionAdapter", () => {
  it("initializes correctly with defaults", () => {
    const adapter = new TestDiscussionAdapter();
    expect(adapter.name).toBe("test-adapter");
    expect(adapter.modelId).toBe("test-model");
    expect(adapter.capabilities).toEqual(["test"]);
    expect(adapter.supportedRoles).toEqual(["test-role"]);
  });

  it("handles basic ask scenario", async () => {
    const adapter = new TestDiscussionAdapter();
    const response = await adapter.respond({
      roomId: "r1",
      roomName: "Test Room",
      task: "Test task",
      role: "test-role",
      phase: "open_room",
      rules: "",
      timeline: [],
      artifacts: [],
    });

    expect(adapter.executeCompletionCalls).toHaveLength(1);
    const { system, user } = adapter.executeCompletionCalls[0];
    
    // System prompt verification
    expect(system).toContain("Assigned role: test-role.");
    expect(system).toContain("Be concrete and simple.");
    expect(system).toContain("STEP 2 OUTPUT PREFERENCE:");
    expect(system).toContain("full_text, summary, intent, and optional claims");
    expect(system).toContain("fall back to a normal plain-text reply");
    expect(user).toContain("Actionable events:");
    
    // Output verification
    expect(response.text).toBe("Test response");
    expect(response.confidence).toBeGreaterThan(0);
  });

  it("includes compact summary and claims in the discussion user prompt", async () => {
    const adapter = new TestDiscussionAdapter();

    await adapter.respond({
      roomId: "r1",
      roomName: "Test Room",
      task: "Test task",
      role: "test-role",
      phase: "open_room",
      rules: "",
      actionableEvents: [
        {
          id: "a1",
          timestamp: "T1",
          phase: "open_room",
          from: "agent-a",
          to: "room",
          scope: "room",
          intent: "critique",
          text: "This plan needs a smaller rollout slice.",
          summary: "Smaller rollout slice needed.",
          claims: [{ text: "Large rollout increases coordination risk." }]
        }
      ],
      recentCompacts: [
        {
          messageId: "m1",
          summary: "Compact bridge summary",
          claims: ["Bridge-first rollout lowers coordination risk."],
          intent: "propose",
          representationSource: "self_declared",
          score: 0.82
        }
      ],
      memoryArtifacts: [
        {
          id: "mem-1",
          artifactKind: "segment_summary",
          summary: "Segment memory summary",
          highlights: ["h1"],
          openQuestions: ["q1"],
          createdAt: "2026-04-25T05:00:00.000Z"
        }
      ],
      normalizedClaims: [
        {
          id: "claim-1",
          canonicalText: "Bridge rollout lowers migration risk.",
          canonicalKey: "bridge rollout lowers migration risk",
          evidenceCount: 2,
          updatedAt: "2026-04-25T05:01:00.000Z"
        }
      ],
      claimRelations: [
        {
          id: "rel-1",
          fromClaimId: "claim-1",
          toClaimId: "claim-2",
          relationType: "supports",
          updatedAt: "2026-04-25T05:02:00.000Z"
        }
      ],
      timeline: [
        {
          id: "m1",
          timestamp: "T2",
          phase: "open_room",
          from: "agent-b",
          to: "room",
          scope: "room",
          intent: "propose",
          text: "Ship the bridge first and measure.",
          summary: "Ship the bridge first.",
          claims: ["Bridge-first rollout lowers migration risk."]
        }
      ],
      artifacts: [],
    });

    const { user } = adapter.executeCompletionCalls[0];
    expect(user).toContain("Recent compacts:");
    expect(user).toContain("Derived memory artifacts:");
    expect(user).toContain("Claim-aware context:");
    expect(user).toContain("Claims:");
    expect(user).toContain("- claim-1: Bridge rollout lowers migration risk. {evidence=2}");
    expect(user).toContain("Relations:");
    expect(user).toContain("- claim-1 supports claim-2");
    expect(user).toContain("- Segment memory summary {kind=segment_summary; highlights=h1; open=q1}");
    expect(user).toContain("- m1 {summary=Compact bridge summary; claims=Bridge-first rollout lowers coordination risk.; intent=propose; source=self_declared; score=0.82}");
    expect(user).toContain("Ship the bridge first and measure. {summary=Ship the bridge first.; claims=Bridge-first rollout lowers migration risk.}");
    expect(user).toContain("This plan needs a smaller rollout slice. {summary=Smaller rollout slice needed.; claims=Large rollout increases coordination risk.}");
  });

  it("extracts step1 envelope from a structured json response", async () => {
    const adapter = new TestDiscussionAdapter();
    adapter.mockResponse = JSON.stringify({
      full_text: "We should ship the bridge first.",
      summary: "Ship the bridge first.",
      intent: "propose",
      claims: [{ text: "Bridge rollout reduces migration risk." }]
    });

    const response = await adapter.respond({
      roomId: "r1",
      roomName: "Test Room",
      task: "Test task",
      role: "test-role",
      phase: "open_room",
      rules: "",
      timeline: [],
      artifacts: [],
    });

    expect(response.text).toBe("We should ship the bridge first.");
    expect(response.step1Envelope).toEqual({
      parseMode: "preferred_json",
      fullText: "We should ship the bridge first.",
      summary: "Ship the bridge first.",
      intent: "propose",
      claims: [{ text: "Bridge rollout reduces migration risk." }]
    });
  });

  it("extracts step1 envelope from labeled structured text", async () => {
    const adapter = new TestDiscussionAdapter();
    adapter.mockResponse = [
      "full_text: We should keep Step 2 incremental.",
      "summary: Keep Step 2 incremental.",
      "intent: refine",
      "claims:",
      "- Prompt changes should stay low-risk.",
      "- Runtime parsing should tolerate weak structure."
    ].join("\n");

    const response = await adapter.respond({
      roomId: "r1",
      roomName: "Test Room",
      task: "Test task",
      role: "test-role",
      phase: "open_room",
      rules: "",
      timeline: [],
      artifacts: [],
    });

    expect(response.text).toBe("We should keep Step 2 incremental.");
    expect(response.step1Envelope).toEqual({
      parseMode: "preferred_json",
      fullText: "We should keep Step 2 incremental.",
      summary: "Keep Step 2 incremental.",
      intent: "refine",
      claims: [
        { text: "Prompt changes should stay low-risk." },
        { text: "Runtime parsing should tolerate weak structure." }
      ]
    });
  });
  
  it("estimates costs based on historical usage properly", async () => {
    const adapter = new TestDiscussionAdapter();
    const estimate = await adapter.estimateCost(
      {
        roomId: "r1",
        roomName: "Room 1",
        task: "Task",
        role: "researcher",
        phase: "independent_answers",
        rules: "",
        timeline: [{ id: "1", timestamp: "T", phase: "P", from: "A", to: "B", scope: "room", text: "Text" }],
        artifacts: [],
      },
      "Test text"
    );
    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.outputTokens).toBeGreaterThan(0);
  });
});
