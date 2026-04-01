import { bearer, sanitizeBaseUrl } from "./auth.js";
import {
  HeartbeatPayload,
  NodeApprovalStatusResponse,
  HeartbeatResponse,
  JoinRoomResponse,
  PostRoomMessageInput,
  RegisterNodeRequest,
  RegisterNodeResponse,
  RoomContext,
  SubmitUsageResponse,
  UsageRecord
} from "./types.js";

export interface HexNestClientOptions {
  nodeToken?: string;
  timeoutMs?: number;
}

export interface HexNestClientLike {
  registerNode(payload: RegisterNodeRequest): Promise<RegisterNodeResponse>;
  getNodeStatus(nodeId: string): Promise<NodeApprovalStatusResponse>;
  heartbeat(nodeId: string, payload: HeartbeatPayload): Promise<HeartbeatResponse>;
  submitUsage(nodeId: string, records: UsageRecord[]): Promise<SubmitUsageResponse>;
  markOffline(nodeId: string): Promise<void>;
  joinRoom(roomId: string, agentName: string, role: string): Promise<JoinRoomResponse>;
  postRoomMessage(input: PostRoomMessageInput): Promise<void>;
  getRoomContext(roomId: string, role: string): Promise<RoomContext>;
}

export class HexNestClient implements HexNestClientLike {
  constructor(coreUrl: string, options: HexNestClientOptions = {}) {
    this.coreUrl = sanitizeBaseUrl(coreUrl);
    this.nodeToken = options.nodeToken;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  private readonly coreUrl: string;
  private readonly nodeToken?: string;
  private readonly timeoutMs: number;

  async registerNode(payload: RegisterNodeRequest): Promise<RegisterNodeResponse> {
    return this.request<RegisterNodeResponse>("/api/nodes/register", {
      method: "POST",
      body: payload
    });
  }

  async getNodeStatus(nodeId: string): Promise<NodeApprovalStatusResponse> {
    return this.request<NodeApprovalStatusResponse>(`/api/nodes/${encodeURIComponent(nodeId)}/status`, {
      method: "GET",
      authRequired: true
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

  async postRoomMessage(input: PostRoomMessageInput): Promise<void> {
    const body: Record<string, unknown> = {
      agentId: input.joinedAgentId,
      text: input.text,
      confidence: input.confidence ?? 0.75
    };
    if (Array.isArray(input.artifacts) && input.artifacts.length > 0) {
      body.artifacts = input.artifacts;
    }
    if (input.pythonCode) {
      body.pythonCode = input.pythonCode;
    }
    if (typeof input.needHuman === "boolean") {
      body.needHuman = input.needHuman;
    }

    await this.request(`/api/rooms/${encodeURIComponent(input.roomId)}/messages`, {
      method: "POST",
      body
    });
  }

  async getRoomContext(roomId: string, role: string): Promise<RoomContext> {
    const encodedRoomId = encodeURIComponent(roomId);
    const [room, messages] = await Promise.all([
      this.request<Record<string, unknown>>(`/api/rooms/${encodedRoomId}`),
      this.request<Record<string, unknown>>(`/api/rooms/${encodedRoomId}/messages`)
    ]);

    const rawTimeline = Array.isArray(messages.messages) ? messages.messages : [];
    const timeline = rawTimeline.map((item) => {
      const value = item as Record<string, unknown>;
      const scope: "room" | "direct" = value.scope === "direct" ? "direct" : "room";
      return {
        id: String(value.id || ""),
        timestamp: String(value.timestamp || ""),
        phase: String(value.phase || room.phase || "open_room"),
        from: String(value.from || "unknown"),
        to: String(value.to || "room"),
        scope,
        text: String(value.text || ""),
        confidence: typeof value.confidence === "number" ? value.confidence : undefined
      };
    });

    const rawArtifacts = Array.isArray(room.artifacts) ? room.artifacts : [];
    const artifacts = rawArtifacts.map((item, index) => {
      const value = item as Record<string, unknown>;
      return {
        id: String(value.id || `artifact-${index}`),
        type: (String(value.type || "note") as "synthesis" | "critique" | "note" | "data"),
        label: String(value.label || ""),
        content: String(value.content || ""),
        producer: String(value.producer || ""),
        timestamp: String(value.timestamp || "")
      };
    });

    return {
      roomId,
      roomName: String(room.name || `Room ${roomId.slice(0, 8)}`),
      task: String(room.task || ""),
      role,
      phase: String(room.phase || "open_room"),
      timeline,
      artifacts,
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
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
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Core API failed ${response.status} ${response.statusText}: ${body}`);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const text = await response.text();
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error(`Core API timeout after ${this.timeoutMs}ms: ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
