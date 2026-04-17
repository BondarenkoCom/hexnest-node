import { BaseLocalAdapter, LocalAdapterOptions } from "./BaseLocalAdapter.js";

interface OpenAILikeChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class LlamaCppAdapter extends BaseLocalAdapter {
  constructor(
    private readonly apiKey: string = "not-needed",
    options: LocalAdapterOptions = {}
  ) {
    super(
      "llama-cpp",
      "local-model",
      "http://127.0.0.1:8080/v1",
      "LLAMACPP_MAX_TOKENS",
      "LLAMACPP_CACHE_TTL_MS",
      options
    );
  }

  protected async executeRequest(
    system: string,
    prompt: string,
    maxTokens: number,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt }
          ],
          temperature: 0.3,
          max_tokens: maxTokens
        })
      });
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error(`Llama.cpp request timed out after ${timeoutMs}ms`);
      }
      if (error?.code === "ECONNREFUSED" || String(error?.message || "").includes("fetch failed")) {
        throw new Error(
          `Llama.cpp is NOT responding at ${this.baseUrl}. Please ensure llama.cpp server is running and accessible.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  protected async extractTextFromResponse(response: Response): Promise<string> {
    const payload = (await response.json()) as OpenAILikeChatResponse;
    return String(payload.choices?.[0]?.message?.content || "").trim();
  }
}
