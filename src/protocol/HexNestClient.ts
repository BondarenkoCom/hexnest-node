import { bearer, sanitizeBaseUrl } from "./auth.js";
import {
  HeartbeatPayload,
  HeartbeatResponse,
  JoinRoomResponse,
  RegisterNodeRequest,
  RegisterNodeResponse,
  RoomContext,
  SubmitUsageResponse,
  UsageRecord
} from "./types.js";

export class HexNestClient {
  constructor(
    coreUrl: string,
    private readonly nodeToken?: string
  ) {
    this.coreUrl = sanitizeBaseUrl(coreUrl);
  }

  private readonly coreUrl: string;

  async registerNode(payload: RegisterNodeRequest): Promise<RegisterNodeResponse> {
    return this.request<RegisterNodeResponse>("/api/nodes/register", {
      method: "POST",
      body: payload
    });
  }

  async heartbeat(nodeId: string, payload: HeartbeatPayload): Promise<HeartbeatResponse> {
    return this.request<HeartbeatResponse>(`/api/nodes/${encodeURIComponent(nodeId)}/heartbeat`, {
      method: "POST",
      authRequired: true,
      body: payload
    });
  }

  async submitUsage(nodeId: string, records: UsageRecord[]): Promise<SubmitUsageResponse> {
    return this.request<SubmitUsageResponse>(`/api/nodes/${encodeURIComponent(nodeId)}/usage`, {
      method: "POST",
      authRequired: true,
      body: { records }
    });
  }

  async markOffline(nodeId: string): Promise<void> {
    await this.request(`/api/nodes/${encodeURIComponent(nodeId)}/offline`, {
      method: "POST",
      authRequired: true,
      body: {}
    });
  }

  async joinRoom(roomId: string, agentName: string, role: string): Promise<JoinRoomResponse> {
    return this.request<JoinRoomResponse>(`/api/rooms/${encodeURIComponent(roomId)}/agents`, {
      method: "POST",
      body: {
        name: agentName,
        role
      }
    });
  }

  async postRoomMessage(
    roomId: string,
    joinedAgentId: string,
    text: string,
    confidence = 0.75
  ): Promise<void> {
    await this.request(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
      method: "POST",
      body: {
        agentId: joinedAgentId,
        text,
        confidence
      }
    });
  }

  async getRoomContext(roomId: string, role: string): Promise<RoomContext> {
    const room = await this.request<Record<string, unknown>>(`/api/rooms/${encodeURIComponent(roomId)}`);
    const messages = await this.request<Record<string, unknown>>(`/api/rooms/${encodeURIComponent(roomId)}/messages`);

    const rawTimeline = Array.isArray(messages.messages) ? messages.messages : [];
    const timeline = rawTimeline.map((item) => {
      const value = item as Record<string, unknown>;
      const scope: "room" | "direct" = value.scope === "direct" ? "direct" : "room";
      return {
        id: String(value.id || ""),
        timestamp: String(value.timestamp || ""),
        phase: "open_room",
        from: String(value.from || "unknown"),
        to: String(value.to || "room"),
        scope,
        text: String(value.text || ""),
        confidence: typeof value.confidence === "number" ? value.confidence : undefined
      };
    });

    return {
      roomId,
      roomName: String(room.name || `Room ${roomId.slice(0, 8)}`),
      task: String(room.task || ""),
      role,
      phase: String(room.phase || "open_room"),
      timeline,
      artifacts: [],
      rules: String((room.template as Record<string, unknown> | undefined)?.rules || "")
    };
  }

  private async request<T = unknown>(
    path: string,
    options: {
      method?: string;
      authRequired?: boolean;
      body?: unknown;
    } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (options.authRequired) {
      if (!this.nodeToken) {
        throw new Error("Node token is required for this request");
      }
      headers.Authorization = bearer(this.nodeToken);
    }

    const response = await fetch(`${this.coreUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Core API failed ${response.status} ${response.statusText}: ${body}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }
}
