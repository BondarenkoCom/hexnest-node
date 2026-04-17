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
      id: "run-1",
      roomId: "r1",
      roomName: "Test Room",
      task: "Test task",
      role: "cli-role",
      phase: "open_room",
      timeline: [],
      artifacts: [],
    });

    expect(adapter.executeCliCalls).toHaveLength(1);
    const prompt = adapter.executeCliCalls[0];
    
    // Prompt structure verification
    expect(prompt).toContain("You are test-cli-adapter in HexNest room.");
    expect(prompt).toContain("Assigned role: cli-role.");
    expect(prompt).toContain("Task: Test task");
    
    // Output verification
    expect(response.text).toBe("CLI command complete");
    expect(response.confidence).toBeGreaterThan(0);
  });
  
  it("estimates costs properly", async () => {
    const adapter = new TestCliAdapter();
    const estimate = await adapter.estimateCost(
      {
        id: "run-1",
        roomId: "r1",
        roomName: "Room 1",
        task: "Task",
        role: "researcher",
        phase: "independent_answers",
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
