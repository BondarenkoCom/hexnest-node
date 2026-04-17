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

export class LmStudioAdapter extends BaseLocalAdapter {
  constructor(
    private readonly apiKey: string = "not-needed",
    options: LocalAdapterOptions = {}
  ) {
    super(
      "lm-studio",
      "local-model",
      "http://127.0.0.1:1234/v1",
      "LMSTUDIO_MAX_TOKENS",
      "LMSTUDIO_CACHE_TTL_MS",
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
        throw new Error(`LM Studio request timed out after ${timeoutMs}ms`);
      }
      if (error?.code === "ECONNREFUSED" || String(error?.message || "").includes("fetch failed")) {
        throw new Error(
          `LM Studio is NOT responding at ${this.baseUrl}. Please ensure LM Studio is running and accessible.`
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
