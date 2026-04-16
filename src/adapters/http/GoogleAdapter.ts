import { AgentAdapter, AgentResponse } from "../core/AgentAdapter.js";
import { RoomContext } from "../../protocol/types.js";
import { extractUsageSnapshot } from "../core/costing.js";
import { BaseDiscussionAdapter } from "../core/BaseDiscussionAdapter.js";

interface GoogleGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export class GoogleAdapter extends BaseDiscussionAdapter {
  protected readonly styleLine = "Be concrete. Keep output compact and high-signal.";
  private readonly maxOutputTokens: number;

  constructor(
    private readonly apiKey: string,
    options: {
      name?: string;
      model?: string;
      baseUrl?: string;
      capabilities?: string[];
      supportedRoles?: string[];
    } = {}
  ) {
    super({
      name: options.name || "google",
      model: options.model || "gemini-2.5-flash",
      baseUrl: options.baseUrl || "https://generativelanguage.googleapis.com/v1beta",
      capabilities: options.capabilities,
      supportedRoles: options.supportedRoles,
      defaultCapabilities: ["general", "reasoning", "coding", "research"],
      defaultRoles: ["researcher", "skeptic", "builder", "synthesizer", "judge"]
    });
    this.maxOutputTokens = Math.max(64, Number(process.env.GOOGLE_MAX_TOKENS || 1200));
  }

  protected async executeCompletion(
    systemPrompt: string, 
    userPrompt: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("GOOGLE_API_KEY is missing");
    }

    const endpoint = `${(this.baseUrl || "").replace(/\/+$/, "")}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: this.maxOutputTokens
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google call failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as GoogleGenerateContentResponse;
    this.lastUsage = extractUsageSnapshot(payload, {
      inputPath: "usageMetadata.promptTokenCount",
      outputPath: "usageMetadata.candidatesTokenCount"
    });

    return String(payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "").trim();
  }
}



