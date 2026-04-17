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
    
    // Output verification
    expect(response.text).toBe("Test response");
    expect(response.confidence).toBeGreaterThan(0);
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
