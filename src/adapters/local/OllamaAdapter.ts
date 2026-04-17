import { BaseLocalAdapter, LocalAdapterOptions } from "./BaseLocalAdapter.js";

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

export class OllamaAdapter extends BaseLocalAdapter {
  constructor(options: LocalAdapterOptions = {}) {
    super(
      "ollama-local",
      "qwen2.5:14b",
      "http://127.0.0.1:11434",
      "OLLAMA_NUM_PREDICT",
      "OLLAMA_CACHE_TTL_MS",
      options,
      ["general", "code", "research"],
      ["researcher", "skeptic", "builder", "bull", "bear"],
      "Respond with direct, evidence-focused, concise output."
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
      return await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          options: {
            num_predict: maxTokens
          },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt }
          ]
        })
      });
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error(`Ollama request timed out after ${timeoutMs}ms`);
      }
      if (error?.code === "ECONNREFUSED" || String(error?.message || "").includes("fetch failed")) {
        throw new Error(
          `Ollama is NOT responding at ${this.baseUrl}. Please ensure Ollama is running and accessible.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  protected async extractTextFromResponse(response: Response): Promise<string> {
    const payload = (await response.json()) as OllamaChatResponse;
    return String(payload.message?.content || "").trim();
  }
}


