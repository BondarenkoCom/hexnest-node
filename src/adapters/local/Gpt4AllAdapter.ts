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

export class Gpt4AllAdapter extends BaseLocalAdapter {
  constructor(
    private readonly apiKey: string = "not-needed",
    options: LocalAdapterOptions = {}
  ) {
    super(
      "gpt4all",
      "local-model",
      "http://127.0.0.1:4891/v1",
      "GPT4ALL_MAX_TOKENS",
      "GPT4ALL_CACHE_TTL_MS",
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
        throw new Error(`GPT4All request timed out after ${timeoutMs}ms`);
      }
      if (error?.code === "ECONNREFUSED" || String(error?.message || "").includes("fetch failed")) {
        throw new Error(
          `GPT4All is NOT responding at ${this.baseUrl}. Please ensure GPT4All is running and accessible.`
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
