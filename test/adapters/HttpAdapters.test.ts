import { describe, expect, it, vi, afterEach } from "vitest";
import { MistralAdapter } from "../../src/adapters/http/MistralAdapter.js";
import { QwenAdapter } from "../../src/adapters/http/QwenAdapter.js";
import { ClaudeAdapter } from "../../src/adapters/http/ClaudeAdapter.js";
import { DeepSeekAdapter } from "../../src/adapters/http/DeepSeekAdapter.js";
import { GoogleAdapter } from "../../src/adapters/http/GoogleAdapter.js";
import { GrokAdapter } from "../../src/adapters/http/GrokAdapter.js";
import { CohereAdapter } from "../../src/adapters/http/CohereAdapter.js";
import { OpenAIAdapter } from "../../src/adapters/http/OpenAIAdapter.js";

const fetchMock = vi.fn();
global.fetch = fetchMock as any;

describe("MistralAdapter", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("configures defaults accurately", () => {
    const adapter = new MistralAdapter("fake-key");
    expect(adapter.name).toBe("mistral");
    expect(adapter.modelId).toBe("mistral-large-latest");
    expect(adapter.baseUrl).toBe("https://api.mistral.ai/v1");
  });

  it("allows overriding defaults", () => {
    const adapter = new MistralAdapter("fake-key", { 
      name: "custom-mistral", 
      model: "mistral-small" 
    });
    expect(adapter.name).toBe("custom-mistral");
    expect(adapter.modelId).toBe("mistral-small");
  });

  it("executes completion passing correct auth and json structure", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "I am mistral." }}],
        usage: { prompt_tokens: 10, completion_tokens: 10 }
      })
    });

    const adapter = new MistralAdapter("fake-key");
    // executeCompletion is protected, use any cast for testing the mapping
    const res = await (adapter as any).executeCompletion("system prompt", "user prompt");
    
    expect(res).toBe("I am mistral.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    const [url, requestInit] = fetchMock.mock.calls[0];
    expect(url).toContain("https://api.mistral.ai/v1/chat/completions");
    expect(requestInit.headers.Authorization).toBe("Bearer fake-key");
    
    const body = JSON.parse(requestInit.body);
    expect(body.model).toBe("mistral-large-latest");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe("system prompt");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toBe("user prompt");
  });
});

describe("QwenAdapter", () => {
  it("configures defaults accurately", () => {
    const adapter = new QwenAdapter("fake-key");
    expect(adapter.name).toBe("qwen");
    expect(adapter.modelId).toBe("qwen-plus");
    expect(adapter.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
  });
});

describe("ClaudeAdapter", () => {
  it("configures defaults accurately", () => {
    const adapter = new ClaudeAdapter("fake-key");
    expect(adapter.name).toBe("claude");
    expect(adapter.modelId).toBe("claude-3-7-sonnet-latest");
    expect(adapter.baseUrl).toBe("https://api.anthropic.com/v1");
  });
});

describe("DeepSeekAdapter", () => {
  it("configures defaults accurately", () => {
    const adapter = new DeepSeekAdapter("fake-key");
    expect(adapter.name).toBe("deepseek");
    expect(adapter.modelId).toBe("deepseek-chat");
    expect(adapter.baseUrl).toBe("https://api.deepseek.com");
  });
});

describe("GoogleAdapter", () => {
  it("configures defaults accurately", () => {
    const adapter = new GoogleAdapter("fake-key");
    expect(adapter.name).toBe("google");
    expect(adapter.modelId).toBe("gemini-2.5-flash");
    expect(adapter.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });
});

describe("GrokAdapter", () => {
  it("configures defaults accurately", () => {
    const adapter = new GrokAdapter("fake-key");
    expect(adapter.name).toBe("grok");
    expect(adapter.modelId).toBe("grok-4-1-fast");
    expect(adapter.baseUrl).toBe("https://api.x.ai/v1");
  });
});

describe("CohereAdapter", () => {
  it("configures defaults accurately", () => {
    const adapter = new CohereAdapter("fake-key");
    expect(adapter.name).toBe("cohere");
    expect(adapter.modelId).toBe("command-r-plus");
    expect(adapter.baseUrl).toBe("https://api.cohere.ai/v1");
  });
});

describe("OpenAIAdapter", () => {
  it("configures defaults accurately", () => {
    const adapter = new OpenAIAdapter("fake-key");
    expect(adapter.name).toBe("openai");
    expect(adapter.modelId).toBe("gpt-4o-mini");
    expect(adapter.baseUrl).toBe("https://api.openai.com/v1");
  });
});
