import { describe, expect, it } from "vitest";
import { LmStudioAdapter } from "../../src/adapters/local/LmStudioAdapter.js";
import { OpenCodeCliAdapter } from "../../src/adapters/cli/OpenCodeCliAdapter.js";
import { CopilotCliAdapter } from "../../src/adapters/cli/CopilotCliAdapter.js";
import { ClaudeCodeCliAdapter } from "../../src/adapters/cli/ClaudeCodeCliAdapter.js";
import { GeminiCliAdapter } from "../../src/adapters/cli/GeminiCliAdapter.js";
import { LlamaCppAdapter } from "../../src/adapters/local/LlamaCppAdapter.js";
import { Gpt4AllAdapter } from "../../src/adapters/local/Gpt4AllAdapter.js";

describe("LmStudioAdapter", () => {
  it("configures local environment properly", () => {
    const adapter = new LmStudioAdapter();
    expect(adapter.name).toBe("lm-studio");
    expect(adapter.modelId).toBe("local-model"); // Defaults to local-model if none given
    expect(adapter.baseUrl).toBe("http://127.0.0.1:1234/v1"); // Checks default local URL
    expect(adapter.capabilities).toContain("general");
  });
});

describe("OpenCodeCliAdapter", () => {
  it("configures cli properties appropriately", () => {
    const adapter = new OpenCodeCliAdapter();
    expect(adapter.name).toBe("opencode-cli");
    expect(adapter.modelId).toBe("opencode");
    expect(adapter.capabilities).toContain("coding");
  });
});

describe("CopilotCliAdapter", () => {
  it("configures cli properties appropriately", () => {
    const adapter = new CopilotCliAdapter();
    expect(adapter.name).toBe("copilot-cli");
    expect(adapter.modelId).toBe("copilot-cli");
    expect(adapter.capabilities).toContain("coding");
  });
});

describe("ClaudeCodeCliAdapter", () => {
  it("configures cli properties appropriately", () => {
    const adapter = new ClaudeCodeCliAdapter();
    expect(adapter.name).toBe("claude-code-cli");
    expect(adapter.modelId).toBe("claude-3-7-sonnet-latest");
    expect(adapter.capabilities).toContain("coding");
  });
});

describe("GeminiCliAdapter", () => {
  it("configures cli properties appropriately", () => {
    const adapter = new GeminiCliAdapter();
    expect(adapter.name).toBe("gemini-cli");
    expect(adapter.modelId).toBe("gemini-cli");
    expect(adapter.capabilities).toContain("general");
  });
});

describe("LlamaCppAdapter", () => {
  it("configures local properties appropriately", () => {
    const adapter = new LlamaCppAdapter();
    expect(adapter.name).toBe("llama-cpp");
    expect(adapter.modelId).toBe("local-model");
    expect(adapter.baseUrl).toBe("http://127.0.0.1:8080/v1");
  });
});

describe("Gpt4AllAdapter", () => {
  it("configures local properties appropriately", () => {
    const adapter = new Gpt4AllAdapter();
    expect(adapter.name).toBe("gpt4all");
    expect(adapter.modelId).toBe("local-model");
    expect(adapter.baseUrl).toBe("http://127.0.0.1:4891/v1");
  });
});
