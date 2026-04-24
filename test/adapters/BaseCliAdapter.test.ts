import { describe, expect, it } from "vitest";
import { BaseCliAdapter } from "../../src/adapters/core/BaseCliAdapter.js";

// Create a concrete implementation for testing
class TestCliAdapter extends BaseCliAdapter {
  public mockResponse = "CLI command complete";
  public executeCliCalls: string[] = [];

  constructor() {
    super({
      name: "test-cli-adapter",
      modelId: "test-cli-model",
      capabilities: ["cli"],
      supportedRoles: ["cli-role"],
      timeoutMs: 1000,
    });
  }

  protected async executeCli(prompt: string): Promise<string> {
    this.executeCliCalls.push(prompt);
    return this.mockResponse;
  }
}

describe("BaseCliAdapter", () => {
  it("initializes correctly with defaults", () => {
    const adapter = new TestCliAdapter();
    expect(adapter.name).toBe("test-cli-adapter");
    expect(adapter.modelId).toBe("test-cli-model");
    expect(adapter.capabilities).toEqual(["cli"]);
    expect(adapter.supportedRoles).toEqual(["cli-role"]);
  });

  it("handles basic respond scenario", async () => {
    const adapter = new TestCliAdapter();
    const response = await adapter.respond({
      roomId: "r1",
      roomName: "Test Room",
      task: "Test task",
      role: "cli-role",
      phase: "open_room",
      rules: "",
      timeline: [],
      artifacts: [],
    });

    expect(adapter.executeCliCalls).toHaveLength(1);
    const prompt = adapter.executeCliCalls[0];
    
    // Prompt structure verification
    expect(prompt).toContain("You are test-cli-adapter in HexNest room.");
    expect(prompt).toContain("Assigned role: cli-role.");
    expect(prompt).toContain("Task: Test task");
    expect(prompt).toContain("STEP 2 OUTPUT PREFERENCE:");
    expect(prompt).toContain("full_text, summary, intent, and optional claims");
    expect(prompt).toContain("fall back to a normal plain-text reply");
    expect(prompt).toContain("Participate as a live collaborator in an ongoing discussion");
    expect(prompt).not.toContain("Follow DECIDE -> ACT -> REPORT.");
    
    // Output verification
    expect(response.text).toBe("CLI command complete");
    expect(response.confidence).toBeGreaterThan(0);
  });

  it("includes compact summary and claims in the cli prompt context", async () => {
    const adapter = new TestCliAdapter();

    await adapter.respond({
      roomId: "r1",
      roomName: "Test Room",
      task: "Test task",
      role: "cli-role",
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
          intent: "question",
          text: "Can we reduce rollout scope first?",
          summary: "Reduce rollout scope first.",
          claims: [{ text: "Smaller rollout is easier to verify." }]
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
          text: "Use the bridge path before replacing reads.",
          summary: "Bridge before replacing reads.",
          claims: ["Bridge-first rollout protects the legacy path."]
        }
      ],
      artifacts: [],
    });

    const prompt = adapter.executeCliCalls[0];
    expect(prompt).toContain("Use the bridge path before replacing reads. {summary=Bridge before replacing reads.; claims=Bridge-first rollout protects the legacy path.}");
    expect(prompt).toContain("Can we reduce rollout scope first? {summary=Reduce rollout scope first.; claims=Smaller rollout is easier to verify.}");
  });

  it("extracts step1 envelope from a fenced json cli response", async () => {
    const adapter = new TestCliAdapter();
    adapter.mockResponse = [
      "```json",
      JSON.stringify({
        full_text: "The current plan is good enough for rollout.",
        summary: "Proceed with rollout.",
        intent: "agree"
      }),
      "```"
    ].join("\n");

    const response = await adapter.respond({
      roomId: "r1",
      roomName: "Test Room",
      task: "Test task",
      role: "cli-role",
      phase: "open_room",
      rules: "",
      timeline: [],
      artifacts: [],
    });

    expect(response.text).toBe("The current plan is good enough for rollout.");
    expect(response.step1Envelope).toEqual({
      parseMode: "preferred_json",
      fullText: "The current plan is good enough for rollout.",
      summary: "Proceed with rollout.",
      intent: "agree"
    });
  });

  it("extracts step1 envelope from a fenced json cli response wrapped in prose", async () => {
    const adapter = new TestCliAdapter();
    adapter.mockResponse = [
      "Here is the compact result.",
      "```json",
      JSON.stringify({
        full_text: "We should keep the bridge and measure first.",
        summary: "Keep the bridge and measure first.",
        intent: "refine",
        claims: ["The bridge lowers rollout risk."]
      }),
      "```",
      "Done."
    ].join("\n");

    const response = await adapter.respond({
      roomId: "r1",
      roomName: "Test Room",
      task: "Test task",
      role: "cli-role",
      phase: "open_room",
      rules: "",
      timeline: [],
      artifacts: [],
    });

    expect(response.text).toBe("We should keep the bridge and measure first.");
    expect(response.step1Envelope).toEqual({
      parseMode: "preferred_json",
      fullText: "We should keep the bridge and measure first.",
      summary: "Keep the bridge and measure first.",
      intent: "refine",
      claims: [{ text: "The bridge lowers rollout risk." }]
    });
  });

  it("extracts step1 envelope from labeled cli text", async () => {
    const adapter = new TestCliAdapter();
    adapter.mockResponse = [
      "full_text: We should bridge first and inspect the read path.",
      "summary: Bridge first and inspect reads.",
      "intent: propose",
      "claims:",
      "- The bridge preserves compatibility.",
      "- Read-path changes should come later."
    ].join("\n");

    const response = await adapter.respond({
      roomId: "r1",
      roomName: "Test Room",
      task: "Test task",
      role: "cli-role",
      phase: "open_room",
      rules: "",
      timeline: [],
      artifacts: [],
    });

    expect(response.text).toBe("We should bridge first and inspect the read path.");
    expect(response.step1Envelope).toEqual({
      parseMode: "preferred_json",
      fullText: "We should bridge first and inspect the read path.",
      summary: "Bridge first and inspect reads.",
      intent: "propose",
      claims: [
        { text: "The bridge preserves compatibility." },
        { text: "Read-path changes should come later." }
      ]
    });
  });
  
  it("estimates costs properly", async () => {
    const adapter = new TestCliAdapter();
    const estimate = await adapter.estimateCost(
      {
        roomId: "r1",
        roomName: "Room 1",
        task: "Task",
        role: "researcher",
        phase: "independent_answers",
        rules: "",
        timeline: [{ id: "1", timestamp: "T", phase: "P", from: "A", to: "B", scope: "room", type: "chat", text: "Text" }],
        artifacts: [],
      },
      "Test text"
    );
    expect(estimate.inputTokens).toBeGreaterThan(0);
    // test-cli-model won't have a known price, so estimatedCostUsd will evaluate to 0
    expect(estimate.outputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedCostUsd).toBe(0);
  });
});
