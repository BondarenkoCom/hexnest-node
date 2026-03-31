import { describe, expect, it } from "vitest";
import { OllamaAdapter } from "../src/adapters/OllamaAdapter.js";

describe("OllamaAdapter", () => {
  it("estimates token usage from context text", async () => {
    const adapter = new OllamaAdapter();
    const estimate = await adapter.estimateCost(
      {
        roomId: "r1",
        roomName: "Room 1",
        task: "Evaluate project strengths and weaknesses",
        role: "researcher",
        phase: "independent_answers",
        timeline: [{ id: "e1", timestamp: "2026-01-01T00:00:00Z", phase: "open_room", from: "A", to: "room", scope: "room", text: "hello" }],
        artifacts: [],
        rules: "Cite data"
      },
      "response text"
    );

    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.outputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedCostUsd).toBe(0);
  });

  it("includes common analytical roles", () => {
    const adapter = new OllamaAdapter();
    expect(adapter.supportedRoles).toContain("researcher");
    expect(adapter.supportedRoles).toContain("bull");
  });
});
