import { bearer, sanitizeBaseUrl } from "./auth.js";
import {
  AuthLoginRequest,
  AuthRegisterRequest,
  AuthResponse,
  CoreRoomConnectBrief,
  CoreRoomDetails,
  CoreRoomHeartbeatResponse,
  CoreRoomMessagesResponse,
  CoreRoomSnapshot,
  CoreRoomStats,
  CoreRoomsListResponse,
  CreateCoreRoomInput,
  DeleteNodeResponse,
  HeartbeatPayload,
  NodeApprovalStatusResponse,
  HeartbeatResponse,
  JoinRoomResponse,
  PostRoomMessageInput,
  RegisterNodeRequest,
  RegisterNodeResponse,
  RoomContext,
  SubmitUsageResponse,
  UsageRecord,
  AgentDescriptor
} from "./types.js";

const ACTIONABLE_INTENTS = new Set([
  "ask_room",
  "request_input",
  "request_feedback",
  "request_review",
  "request_plan",
  "request_critique",
  "request_analysis",
  "call_for_input",
  "need_help",
  "need_human",
  "summon_agent",
  "escalate"
]);

export interface HexNestClientOptions {
  nodeToken?: string;
  userToken?: string;
  timeoutMs?: number;
}

export interface HexNestClientLike {
  registerUser(payload: AuthRegisterRequest): Promise<AuthResponse>;
  loginUser(payload: AuthLoginRequest): Promise<AuthResponse>;
  registerNode(payload: RegisterNodeRequest): Promise<RegisterNodeResponse>;
  deleteNode(nodeId: string): Promise<DeleteNodeResponse>;
  getNodeStatus(nodeId: string): Promise<NodeApprovalStatusResponse>;
  heartbeat(nodeId: string, payload: HeartbeatPayload): Promise<HeartbeatResponse>;
  submitUsage(nodeId: string, records: UsageRecord[]): Promise<SubmitUsageResponse>;
  markOffline(nodeId: string): Promise<void>;
  listRooms(limit?: number): Promise<CoreRoomsListResponse>;
  createRoom(payload: CreateCoreRoomInput): Promise<CoreRoomDetails>;
  postAgentDirectory(data: any): Promise<any>;
  deleteAgentDirectory(name: string, endpointUrl: string): Promise<any>;
  getAgentsDirectory(): Promise<{ value: AgentDescriptor[] }>;
  getRoom(roomId: string): Promise<CoreRoomSnapshot>;
  getRoomStats(roomId: string): Promise<CoreRoomStats>;
  getRoomConnectBrief(roomId: string): Promise<CoreRoomConnectBrief>;
  heartbeatRoom(roomId: string, sessionId: string): Promise<CoreRoomHeartbeatResponse>;
  forkRoom(roomId: string): Promise<CoreRoomSnapshot>;
  downloadRoomSummary(roomId: string): Promise<string>;
  exportRoom(roomId: string): Promise<unknown>;
  getRoomMessages(roomId: string, limit?: number): Promise<CoreRoomMessagesResponse>;
  joinRoom(roomId: string, agentName: string, role?: string): Promise<JoinRoomResponse>;
  postRoomMessage(input: PostRoomMessageInput): Promise<void>;
  getRoomContext(roomId: string, role: string): Promise<RoomContext>;
}

export type CoreApiErrorKind = "http" | "timeout" | "network" | "invalid-response";

export class CoreApiError extends Error {
  constructor(
    message: string,
    readonly kind: CoreApiErrorKind,
    readonly details: {
      status?: number;
      statusText?: string;
      contentType?: string | null;
      body?: string;
      path?: string;
      url?: string;
    } = {}
  ) {
    super(message);
    this.name = "CoreApiError";
  }
}

export function isCoreApiError(error: unknown): error is CoreApiError {
  return error instanceof CoreApiError;
}

function trimAndCollapse(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function summarizeErrorBody(body: string, contentType?: string | null): string {
  const normalizedBody = body.trim();
  if (!normalizedBody) {
    return "empty response body";
  }

  const lowerContentType = String(contentType || "").toLowerCase();
  const looksLikeJson =
    lowerContentType.includes("application/json")
    || normalizedBody.startsWith("{")
    || normalizedBody.startsWith("[");

  if (looksLikeJson) {
    try {
      const parsed = JSON.parse(normalizedBody) as Record<string, unknown>;
      const message = parsed.error ?? parsed.message ?? parsed.code;
      if (typeof message === "string" && message.trim()) {
        return trimAndCollapse(message);
      }
    } catch {
      return trimAndCollapse(normalizedBody);
    }
    return trimAndCollapse(normalizedBody);
  }

  const lowerBody = normalizedBody.slice(0, 512).toLowerCase();
  if (
    lowerContentType.includes("text/html")
    || lowerBody.startsWith("<!doctype html")
    || lowerBody.startsWith("<html")
  ) {
    return "upstream returned HTML instead of JSON";
  }

  return trimAndCollapse(normalizedBody);
}

export class HexNestClient implements HexNestClientLike {
  constructor(coreUrl: string, options: HexNestClientOptions = {}) {
    this.coreUrl = sanitizeBaseUrl(coreUrl);
    this.nodeToken = options.nodeToken;
    this.userToken = options.userToken;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  private readonly coreUrl: string;
  private readonly nodeToken?: string;
  private readonly userToken?: string;
  private readonly timeoutMs: number;

  async registerUser(payload: AuthRegisterRequest): Promise<AuthResponse> {
    return this.request<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: payload
    });
  }

  async loginUser(payload: AuthLoginRequest): Promise<AuthResponse> {
    return this.request<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: payload
    });
  }

  async registerNode(payload: RegisterNodeRequest): Promise<RegisterNodeResponse> {
    return this.request<RegisterNodeResponse>("/api/nodes/register", {
      method: "POST",
      body: payload,
      authRequired: "user"
    });
  }

  async deleteNode(nodeId: string): Promise<DeleteNodeResponse> {
    return this.request<DeleteNodeResponse>(`/api/nodes/${encodeURIComponent(nodeId)}`, {
      method: "DELETE",
      authRequired: "user"
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

  async listRooms(limit = 50): Promise<CoreRoomsListResponse> {
    const params = new URLSearchParams();
    if (Number.isFinite(limit) && limit > 0) {
      const normalizedLimit = Math.min(200, Math.max(1, Math.floor(limit)));
      params.set("limit", String(normalizedLimit));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<CoreRoomsListResponse>(`/api/rooms${suffix}`, {
      authRequired: true
    });
  }

  async createRoom(payload: CreateCoreRoomInput): Promise<CoreRoomDetails> {
    return this.request<CoreRoomDetails>("/api/rooms", {
      method: "POST",
      authRequired: true,
      body: payload
    });
  }

  async postAgentDirectory(data: any): Promise<any> {
    return this.request("/api/agents/directory", {
      method: "POST",
      authRequired: true,
      body: data
    });
  }

  async deleteAgentDirectory(name: string, endpointUrl: string): Promise<any> {
    const query = new URLSearchParams({ name, endpointUrl }).toString();
    return this.request(`/api/agents/directory?${query}`, {
      method: "DELETE",
      authRequired: true
    });
  }

  async getAgentsDirectory(): Promise<{ value: AgentDescriptor[] }> {
    return this.request<{ value: AgentDescriptor[] }>("/api/agents/directory", {
      method: "GET"
    });
  }

  async getRoom(roomId: string): Promise<CoreRoomSnapshot> {
    return this.request<CoreRoomSnapshot>(`/api/rooms/${encodeURIComponent(roomId)}`, {
      authRequired: true
    });
  }

  async getRoomStats(roomId: string): Promise<CoreRoomStats> {
    return this.request<CoreRoomStats>(`/api/rooms/${encodeURIComponent(roomId)}/stats`, {
      authRequired: true
    });
  }

  async getRoomConnectBrief(roomId: string): Promise<CoreRoomConnectBrief> {
    return this.request<CoreRoomConnectBrief>(`/api/rooms/${encodeURIComponent(roomId)}/connect`, {
      authRequired: true
    });
  }

  async heartbeatRoom(roomId: string, sessionId: string): Promise<CoreRoomHeartbeatResponse> {
    return this.request<CoreRoomHeartbeatResponse>(`/api/rooms/${encodeURIComponent(roomId)}/heartbeat`, {
      method: "POST",
      authRequired: true,
      body: { sessionId }
    });
  }

  async forkRoom(roomId: string): Promise<CoreRoomSnapshot> {
    return this.request<CoreRoomSnapshot>(`/api/rooms/${encodeURIComponent(roomId)}/fork`, {
      method: "POST",
      authRequired: true
    });
  }

  async downloadRoomSummary(roomId: string): Promise<string> {
    return this.requestText(`/api/rooms/${encodeURIComponent(roomId)}/summary`, {
      method: "POST",
      authRequired: true
    });
  }

  async exportRoom(roomId: string): Promise<unknown> {
    return this.request(`/api/rooms/${encodeURIComponent(roomId)}/export`, {
      authRequired: true
    });
  }

  async getRoomMessages(roomId: string, limit = 50): Promise<CoreRoomMessagesResponse> {
    const params = new URLSearchParams();
    if (Number.isFinite(limit) && limit > 0) {
      params.set("limit", String(limit));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<CoreRoomMessagesResponse>(`/api/rooms/${encodeURIComponent(roomId)}/messages${suffix}`, {
      authRequired: true
    });
  }

  async joinRoom(roomId: string, agentName: string, role?: string): Promise<JoinRoomResponse> {
    const normalizedRole = String(role || "").trim();
    const raw = await this.request<Record<string, unknown>>(`/api/rooms/${encodeURIComponent(roomId)}/agents`, {
      method: "POST",
      authRequired: true,
      body: {
        name: agentName,
        ...(normalizedRole ? { role: normalizedRole } : {})
      }
    });
    // Core API returns `joinedAgent`; normalize to the expected `agent` field.
    const agent = (raw.agent ?? raw.joinedAgent) as JoinRoomResponse["agent"];
    return { ...raw, agent } as JoinRoomResponse;
  }

  async postRoomMessage(input: PostRoomMessageInput): Promise<void> {
    const body: Record<string, unknown> = {
      agentId: input.joinedAgentId,
      joinedAgentId: input.joinedAgentId,
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
    if (input.triggeredBy !== undefined) {
      body.triggeredBy = input.triggeredBy;
    }
    if (input.emotion) {
      body.emotion = input.emotion;
    }
    if (input.metadata && typeof input.metadata === "object") {
      body.metadata = input.metadata;
    }

    await this.request(`/api/rooms/${encodeURIComponent(input.roomId)}/messages`, {
      method: "POST",
      authRequired: true,
      body
    });
  }

  async getRoomContext(roomId: string, role: string): Promise<RoomContext> {
    const encodedRoomId = encodeURIComponent(roomId);
    const [room, messages] = await Promise.all([
      this.request<Record<string, unknown>>(`/api/rooms/${encodedRoomId}`, { authRequired: true }),
      this.request<Record<string, unknown>>(`/api/rooms/${encodedRoomId}/messages?limit=30`, { authRequired: true })
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
        type: value.type ? String(value.type) : undefined,
        intent: value.intent ? String(value.intent) : undefined,
        triggeredBy: value.triggeredBy ? String(value.triggeredBy) : null,
        text: String(value.text || ""),
        emotion:
          value.emotion && typeof value.emotion === "object"
            ? (value.emotion as RoomContext["timeline"][number]["emotion"])
            : undefined,
        metadata:
          value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
            ? (value.metadata as Record<string, unknown>)
            : undefined,
        confidence: typeof value.confidence === "number" ? value.confidence : undefined
      };
    });
    const actionableEvents = timeline
      .filter((event) => {
        const normalizedIntent = String(event.intent || "").trim().toLowerCase();
        return Boolean(
          event.scope === "direct"
          || event.triggeredBy
          || ACTIONABLE_INTENTS.has(normalizedIntent)
        );
      })
      .slice(-6);

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
      debateFastMode: Boolean((room.settings as Record<string, unknown> | undefined)?.debateFastMode),
      contextVersion: "v2",
      timeline,
      actionableEvents,
      contextSummary: `timeline=${timeline.length}; actionable=${actionableEvents.length}; artifacts=${artifacts.length}`,
      artifacts,
      rules: String((room.template as Record<string, unknown> | undefined)?.rules || "")
    };
  }

  private async request<T = unknown>(
    path: string,
    options: {
      method?: string;
      authRequired?: boolean | "user" | "node";
      body?: unknown;
    } = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };

      if (options.authRequired === "user") {
        if (!this.userToken) {
          throw new Error("User token is required for this request");
        }
        headers.Authorization = bearer(this.userToken);
      } else if (options.authRequired === "node" || (options.authRequired === true && path.includes("/nodes/"))) {
        if (!this.nodeToken) {
          throw new Error("Node token is required for this request");
        }
        headers.Authorization = bearer(this.nodeToken);
      } else if (options.authRequired) {
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

      console.log(`[HexNestClient] ${options.method || "GET"} ${path} auth=${options.authRequired ? "YES" : "NO"}`);

      if (!response.ok) {
        const body = await response.text();
        const contentType = response.headers.get("content-type");
        const summary = summarizeErrorBody(body, contentType);
        
        console.error(`[HexNestClient] Core API Error ${response.status}:`, body);
        
        throw new CoreApiError(
          `Core API failed ${response.status} ${response.statusText}: ${summary}`,
          "http",
          {
            status: response.status,
            statusText: response.statusText,
            contentType,
            body,
            path,
            url: `${this.coreUrl}${path}`
          }
        );
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const text = await response.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch (e) {
        throw new CoreApiError(
          `Core API returned invalid JSON for ${path}`,
          "invalid-response",
          {
            contentType: response.headers.get("content-type"),
            body: text,
            path,
            url: `${this.coreUrl}${path}`
          }
        );
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new CoreApiError(
          `Core API timeout after ${this.timeoutMs}ms: ${path}`,
          "timeout",
          {
            path,
            url: `${this.coreUrl}${path}`
          }
        );
      }
      if (error instanceof TypeError) {
        throw new CoreApiError(
          `Core API is unreachable at ${this.coreUrl}${path}`,
          "network",
          {
            path,
            url: `${this.coreUrl}${path}`
          }
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestText(
    path: string,
    options: {
      method?: string;
      authRequired?: boolean | "user" | "node";
      body?: unknown;
    } = {}
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };

      if (options.authRequired === "user") {
        if (!this.userToken) {
          throw new Error("User token is required for this request");
        }
        headers.Authorization = bearer(this.userToken);
      } else if (options.authRequired === "node" || (options.authRequired === true && path.includes("/nodes/"))) {
        if (!this.nodeToken) {
          throw new Error("Node token is required for this request");
        }
        headers.Authorization = bearer(this.nodeToken);
      } else if (options.authRequired) {
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

      console.log(`[HexNestClient] ${options.method || "GET"} ${path} auth=${options.authRequired ? "YES" : "NO"} status=${response.status}`);

      if (!response.ok) {
        const body = await response.text();
        const contentType = response.headers.get("content-type");
        const summary = summarizeErrorBody(body, contentType);
        throw new CoreApiError(
          `Core API failed ${response.status} ${response.statusText}: ${summary}`,
          "http",
          {
            status: response.status,
            statusText: response.statusText,
            contentType,
            body,
            path,
            url: `${this.coreUrl}${path}`
          }
        );
      }

      return await response.text();
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new CoreApiError(
          `Core API timeout after ${this.timeoutMs}ms: ${path}`,
          "timeout",
          {
            path,
            url: `${this.coreUrl}${path}`
          }
        );
      }
      if (error instanceof TypeError) {
        throw new CoreApiError(
          `Core API is unreachable at ${this.coreUrl}${path}`,
          "network",
          {
            path,
            url: `${this.coreUrl}${path}`
          }
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
