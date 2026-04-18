import { Router, Request, Response } from "express";
import { HexNestClient, isCoreApiError } from "../../protocol/HexNestClient.js";
import type {
  AgentDescriptor,
  CoreRoomConnectBrief,
  CoreRoomDetails,
  CoreRoomWebhookInfo,
  CoreRoomSnapshot,
  CoreRoomStats,
  CreateCoreRoomInput,
  JoinRoomResponse,
  Sentiment
} from "../../protocol/types.js";
import type { WebServerContext } from "../server.js";
import { ApiResponse, RoomSessionInfo } from "../types.js";
import { resolveCoreUrl } from "../resolve-core-url.js";

interface LocalRoomsPayload {
  rooms: CoreRoomDetails[];
  availableAgents: AgentDescriptor[];
}

interface LocalRoomDetailPayload {
  room: CoreRoomSnapshot;
  stats: CoreRoomStats | null;
  brief: CoreRoomConnectBrief | null;
  messages: any[];
  availableAgents: AgentDescriptor[];
  localSessions: RoomSessionInfo[];
}
interface LocalRoomHeartbeatPayload {
  viewers?: number;
  localSessions: RoomSessionInfo[];
}

interface LocalRoomSessionControlPayload {
  stopped?: boolean;
  hadActiveRun?: boolean;
  started?: boolean;
  alreadyRunning?: boolean;
  localSessions: RoomSessionInfo[];
}

interface LocalCreateRoomPayload {
  roomId: string;
  roomWebhook?: CoreRoomWebhookInfo;
}

interface LocalRoomWebhookSigningKeyPayload {
  roomWebhook?: CoreRoomWebhookInfo;
  access: "granted" | "forbidden" | "missing";
  message?: string;
}


interface LocalJoinSelfPayload {
  joinedAgent: JoinRoomResponse["agent"];
  roomSessionStarted: boolean;
  roomSessionAlreadyRunning: boolean;
  roomSessionAutonomous: boolean;
  warning?: string;
}

function sendCoreClientError(res: Response, error: unknown): boolean {
  if (!isCoreApiError(error)) {
    return false;
  }
  const status = Number(error.details.status || 500);
  const safeStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  const message = error.message.replace(/^Core API failed \d+\s+[^\:]+:\s*/i, "").trim();
  res.status(safeStatus).json({
    success: false,
    error: message || "Core API error"
  });
  return true;
}

function normalizeText(value: unknown, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSentiment(value: unknown): Sentiment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const label = normalizeText(raw.label, 40).toLowerCase();
  if (!label) {
    return undefined;
  }
  const score =
    typeof raw.score === "number" && Number.isFinite(raw.score)
      ? Math.max(-1, Math.min(1, raw.score))
      : 0;
  const reasoning = normalizeText(raw.reasoning, 240) || undefined;
  return {
    label,
    score,
    ...(reasoning ? { reasoning } : {})
  };
}

function requireCoreUrl(context: WebServerContext): string {
  return resolveCoreUrl(context);
}

function createClient(context: WebServerContext): HexNestClient {
  const nodeIdentity = context.db.getNodeIdentity();
  return new HexNestClient(requireCoreUrl(context), {
    userToken: context.db.getNodeConfig("user_token") || undefined,
    nodeToken: nodeIdentity?.token,
    timeoutMs: context.nodeConfig.httpTimeoutMs
  });
}

async function loadRoomDetail(context: WebServerContext, roomId: string): Promise<LocalRoomDetailPayload> {
  const client = createClient(context);
  const [room, stats, brief, messageResponse] = await Promise.all([
    client.getRoom(roomId),
    client.getRoomStats(roomId).catch(() => null),
    client.getRoomConnectBrief(roomId).catch(() => null),
    client.getRoomMessages(roomId, 30).catch(() => ({ messages: [] }))
  ]);

  return {
    room,
    stats,
    brief,
    messages: messageResponse.messages,
    availableAgents: context.getAvailableAgents(),
    localSessions: context.db.listRoomSessions(roomId)
  };
}

async function loadRoomSummary(context: WebServerContext, roomId: string): Promise<CoreRoomDetails> {
  const client = createClient(context);
  const [room, messageResponse] = await Promise.all([
    client.getRoom(roomId),
    client.getRoomMessages(roomId, 1)
  ]);
  const latestMessage = messageResponse.messages[0];

  return {
    ...room,
    latestMessageText: latestMessage?.text || undefined,
    latestMessageAt: latestMessage?.timestamp || undefined,
    latestMessageFrom: latestMessage?.from || undefined
  };
}

export function roomsRouter(context: WebServerContext) {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    try {
      let coreUrl: string;
      try {
        coreUrl = requireCoreUrl(context);
      } catch (err: any) {
        // Return success with empty list if core not configured
        res.json({
          success: true,
          data: { rooms: [], availableAgents: context.getAvailableAgents() },
          message: err.message
        });
        return;
      }

      const nodeIdentity = context.db.getNodeIdentity();
      if (nodeIdentity) {
        console.log(`[web] Sending nodeToken: ${nodeIdentity.token.slice(0, 15)}...`);
      }
      const client = new HexNestClient(coreUrl, {
        userToken: context.db.getNodeConfig("user_token") || undefined,
        nodeToken: nodeIdentity?.token,
        timeoutMs: context.nodeConfig.httpTimeoutMs
      });

      const list = await client.listRooms(200);
      const directoryRes = await client.getAgentsDirectory();
      const coreAgents = Array.isArray(directoryRes?.value) ? directoryRes.value : [];
      const localAgents = context.getAvailableAgents();

      // Merge local agents with core agents, avoiding duplicates by name
      const availableAgents = [...localAgents].map(la => ({ ...la, source: 'local' }));
      for (const ca of coreAgents) {
        if (!availableAgents.find(la => la.name === ca.name)) {
          availableAgents.push({ ...ca, source: 'core', protocol: ca.protocol });
        }
      }
      
      const sortedSummaries = list.value
        .slice()
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      
      // Map basic info immediately
      const rooms: CoreRoomDetails[] = sortedSummaries.map(s => ({
        id: s.id,
        name: s.name,
        task: s.task,
        subnest: s.subnest,
        status: s.status,
        phase: s.phase,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        connectedAgents: [], // Details not needed for list
        viewers: 0
      }));

      // Enrich top 25 rooms with latest messages (optional optimization)
      const enrichCount = Math.min(rooms.length, 25);
      if (enrichCount > 0) {
        await Promise.all(rooms.slice(0, enrichCount).map(async (room, idx) => {
          try {
            const messageResponse = await client.getRoomMessages(room.id, 1);
            const latest = messageResponse.messages[0];
            if (latest) {
               room.latestMessageText = latest.text;
               room.latestMessageAt = latest.timestamp;
               room.latestMessageFrom = latest.from;
            }
          } catch (e) {
            console.warn(`[web] Failed to enrich room ${room.id}:`, e instanceof Error ? e.message : e);
          }
        }));
      }

      res.json({
        success: true,
        data: {
          rooms,
          availableAgents
        }
      });
    } catch (error) {
      console.error("[web] rooms list error:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error"
      });
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    try {
      const task = normalizeText(req.body?.task, 100000); // Higher limit for admin proxying
      if (!task) {
        res.status(400).json({ success: false, error: "task is required" });
        return;
      }

      const webhookUrl = normalizeText(req.body?.webhookUrl, 1000) || undefined;
      const hasOperatorSession = Boolean(
        normalizeText(context.db.getNodeConfig("user_email"), 320) &&
        normalizeText(context.db.getNodeConfig("user_token"), 4096)
      );
      if (webhookUrl && !hasOperatorSession) {
        res.status(401).json({
          success: false,
          error: "Operator authorization is required to configure room webhooks."
        });
        return;
      }

      const payload: CreateCoreRoomInput = {
        name: normalizeText(req.body?.name, 120) || undefined,
        task,
        subnest: normalizeText(req.body?.subnest, 200) || undefined,
        templateId: normalizeText(req.body?.templateId, 80) || undefined,
        customRoles: Array.isArray(req.body?.customRoles) ? req.body.customRoles : undefined,
        inviteAgentIds: Array.isArray(req.body?.inviteAgentIds) ? req.body.inviteAgentIds : undefined,
        pythonShellEnabled: normalizeBoolean(req.body?.pythonShellEnabled, false),
        webSearchEnabled: normalizeBoolean(req.body?.webSearchEnabled, true),
        marketDataEnabled: normalizeBoolean(req.body?.marketDataEnabled, false),
        webhookUrl,
        isPrivate: typeof req.body?.isPrivate === "boolean" ? req.body.isPrivate : undefined,
        maxMessages: typeof req.body?.maxMessages === "number" ? req.body.maxMessages : undefined,
        maxPythonJobs: typeof req.body?.maxPythonJobs === "number" ? req.body.maxPythonJobs : undefined,
        maxSearchJobs: typeof req.body?.maxSearchJobs === "number" ? req.body.maxSearchJobs : undefined,
        ttlDays: typeof req.body?.ttlDays === "number" ? req.body.ttlDays : undefined,
        enableSentimentAnalysis: typeof req.body?.enableSentimentAnalysis === "boolean" ? req.body.enableSentimentAnalysis : undefined,
        responseConstraint: req.body?.responseConstraint && typeof req.body.responseConstraint === "object" ? {
          type: req.body.responseConstraint.type,
          value: Number(req.body.responseConstraint.value)
        } : undefined
      };

      const client = createClient(context);
      const room = await client.createRoom(payload);

      // Auto-join requested local agents
      const localAgents = context.getAvailableAgents();
      const requestedAgents = Array.isArray(req.body?.inviteAgentIds) ? req.body.inviteAgentIds : [];
      const localToJoin = requestedAgents.filter((id: string) => localAgents.some(a => a.name === id));
      
      for (const agentName of localToJoin) {
        try {
          const joined = await client.joinRoom(room.id, agentName, undefined);
          const modelConfig = context.db.getModelConfig(agentName);
          if (modelConfig?.enabled) {
            await context.startManualRoomSession(
              room.id,
              agentName,
              "",
              joined.agent.id,
              "auto room start"
            );
          }
        } catch (err) {
          console.error(`Failed to auto-join local agent ${agentName}:`, err);
        }
      }

      // IMPORTANT: Frontend expects `roomId` in response to navigate properly
      const response: ApiResponse<LocalCreateRoomPayload> = {
        success: true,
        data: {
          roomId: room.id,
          ...(room.roomWebhook ? { roomWebhook: room.roomWebhook } : {})
        }
      };
      res.status(201).json(response);
    } catch (error) {
      if (sendCoreClientError(res, error)) {
        return;
      }
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.get("/:roomId/webhook-signing-key", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      if (!roomId) {
        res.status(400).json({ success: false, error: "roomId is required" });
        return;
      }

      const client = createClient(context);
      const payload = await client.getRoomWebhookSigningKey(roomId);
      const response: ApiResponse<LocalRoomWebhookSigningKeyPayload> = {
        success: true,
        data: {
          roomWebhook: payload.roomWebhook,
          access: "granted"
        }
      };
      res.json(response);
    } catch (error) {
      if (isCoreApiError(error)) {
        const status = Number(error.details.status || 0);
        if (status === 403 || status === 404) {
          const message = error.message.replace(/^Core API failed \d+\s+[^\:]+:\s*/i, "").trim();
          const response: ApiResponse<LocalRoomWebhookSigningKeyPayload> = {
            success: true,
            data: {
              access: status === 403 ? "forbidden" : "missing",
              message: message || (status === 403 ? "Signing key is unavailable for this account." : "Room webhook is not configured.")
            }
          };
          res.json(response);
          return;
        }
      }
      if (sendCoreClientError(res, error)) {
        return;
      }
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.post("/:roomId/webhook-signing-key/regenerate", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      const currentSigningKey = normalizeText(req.body?.currentSigningKey, 512);
      if (!roomId) {
        res.status(400).json({ success: false, error: "roomId is required" });
        return;
      }
      if (!currentSigningKey) {
        res.status(400).json({ success: false, error: "currentSigningKey is required" });
        return;
      }

      const client = createClient(context);
      const payload = await client.regenerateRoomWebhookSigningKey(roomId, currentSigningKey);
      const response: ApiResponse<LocalRoomWebhookSigningKeyPayload> = {
        success: true,
        data: {
          roomWebhook: payload.roomWebhook,
          access: "granted"
        }
      };
      res.json(response);
    } catch (error) {
      if (isCoreApiError(error)) {
        const status = Number(error.details.status || 0);
        if (status === 403 || status === 404) {
          const message = error.message.replace(/^Core API failed \d+\s+[^\:]+:\s*/i, "").trim();
          const response: ApiResponse<LocalRoomWebhookSigningKeyPayload> = {
            success: true,
            data: {
              access: status === 403 ? "forbidden" : "missing",
              message: message || (status === 403 ? "Signing key is unavailable for this account." : "Room webhook is not configured.")
            }
          };
          res.json(response);
          return;
        }
      }
      if (sendCoreClientError(res, error)) {
        return;
      }
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.get("/:roomId", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      if (!roomId) {
        res.status(400).json({ success: false, error: "roomId is required" });
        return;
      }

      const response: ApiResponse<LocalRoomDetailPayload> = {
        success: true,
        data: await loadRoomDetail(context, roomId)
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.get("/:roomId/stats", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      if (!roomId) {
        res.status(400).json({ success: false, error: "roomId is required" });
        return;
      }

      const client = createClient(context);
      res.json({ success: true, data: await client.getRoomStats(roomId) });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.get("/:roomId/connect", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      if (!roomId) {
        res.status(400).json({ success: false, error: "roomId is required" });
        return;
      }

      const client = createClient(context);
      res.json({ success: true, data: await client.getRoomConnectBrief(roomId) });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.post("/:roomId/heartbeat", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      const sessionId = normalizeText(req.body?.sessionId, 120);
      if (!roomId || !sessionId) {
        res.status(400).json({ success: false, error: "roomId and sessionId are required" });
        return;
      }

      const client = createClient(context);
      const heartbeat = await client.heartbeatRoom(roomId, sessionId);
      const response: ApiResponse<LocalRoomHeartbeatPayload> = {
        success: true,
        data: {
          viewers: heartbeat?.viewers,
          localSessions: context.db.listRoomSessions(roomId)
        }
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.post("/:roomId/fork", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      if (!roomId) {
        res.status(400).json({ success: false, error: "roomId is required" });
        return;
      }

      const client = createClient(context);
      res.json({ success: true, data: await client.forkRoom(roomId) });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.post("/:roomId/summary", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      if (!roomId) {
        res.status(400).json({ success: false, error: "roomId is required" });
        return;
      }

      const client = createClient(context);
      const markdown = await client.downloadRoomSummary(roomId);
      res.type("text/markdown").send(markdown);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.get("/:roomId/export", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      if (!roomId) {
        res.status(400).json({ success: false, error: "roomId is required" });
        return;
      }

      const client = createClient(context);
      res.json({ success: true, data: await client.exportRoom(roomId) });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.post("/:roomId/join-self", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      const agentName = normalizeText(req.body?.agentName, 120);
      const requestedRole = normalizeText(req.body?.role, 80);
      const sessionRole = requestedRole;

      if (!roomId || !agentName) {
        res.status(400).json({ success: false, error: "roomId and agentName are required" });
        return;
      }

      const availableAgents = context.getAvailableAgents();
      const agentExists = availableAgents.some((agent) => agent.name === agentName);
      if (!agentExists) {
        res.status(400).json({ success: false, error: `Unknown local agent: ${agentName}` });
        return;
      }

      const client = createClient(context);
      let joined: Awaited<ReturnType<typeof client.joinRoom>>;
      try {
        joined = await client.joinRoom(roomId, agentName, requestedRole || undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (requestedRole && /role can be set only when room is created from a template/i.test(message)) {
          joined = await client.joinRoom(roomId, agentName, undefined);
        } else {
          throw error;
        }
      }

      const modelConfig = context.db.getModelConfig(agentName);
      let roomSessionStarted = false;
      let roomSessionAlreadyRunning = false;
      let roomSessionAutonomous = false;
      let warning: string | undefined;

      if (modelConfig?.enabled) {
        try {
          const session = await context.startManualRoomSession(
            roomId,
            agentName,
            sessionRole,
            joined.agent.id,
            "manual room join"
          );
          roomSessionStarted = session.started;
          roomSessionAlreadyRunning = session.alreadyRunning;
          roomSessionAutonomous = modelConfig.agentMode === "autonomous";
        } catch (error) {
          warning = error instanceof Error ? error.message : "Failed to start room session";
        }
      }

      const response: ApiResponse<LocalJoinSelfPayload> = {
        success: true,
        data: {
          joinedAgent: joined.agent,
          roomSessionStarted,
          roomSessionAlreadyRunning,
          roomSessionAutonomous,
          warning
        }
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.post("/:roomId/messages", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      const joinedAgentId = normalizeText(req.body?.joinedAgentId || req.body?.agentId, 120);
      const text = normalizeText(req.body?.text, 4000);
      const confidence = typeof req.body?.confidence === "number" ? req.body.confidence : undefined;
      const sentiment = normalizeSentiment(req.body?.sentiment);

      if (!roomId || !joinedAgentId || !text) {
        res.status(400).json({ success: false, error: "roomId, agentId/joinedAgentId and text are required" });
        return;
      }

      const client = createClient(context);
      await client.postRoomMessage({ roomId, joinedAgentId, text, confidence, sentiment });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.post("/:roomId/local-sessions/:agentName/stop", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      const agentName = normalizeText(req.params.agentName, 120);

      if (!roomId || !agentName) {
        res.status(400).json({ success: false, error: "roomId and agentName are required" });
        return;
      }

      const result = await context.stopManualRoomSession(roomId, agentName);
      const response: ApiResponse<LocalRoomSessionControlPayload> = {
        success: true,
        data: {
          stopped: result.stopped,
          hadActiveRun: result.hadActiveRun,
          localSessions: context.db.listRoomSessions(roomId)
        }
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.post("/:roomId/local-sessions/:agentName/start", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      const agentName = normalizeText(req.params.agentName, 120);
      const joinedAgentId = normalizeText(req.body?.joinedAgentId, 120);
      const role = normalizeText(req.body?.role, 80);

      if (!roomId || !agentName || !joinedAgentId) {
        res.status(400).json({ success: false, error: "roomId, agentName and joinedAgentId are required" });
        return;
      }

      const result = await context.startManualRoomSession(roomId, agentName, role, joinedAgentId, "manual room start");
      const response: ApiResponse<LocalRoomSessionControlPayload> = {
        success: true,
        data: {
          started: result.started,
          alreadyRunning: result.alreadyRunning,
          localSessions: context.db.listRoomSessions(roomId)
        }
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  router.post("/:roomId/local-sessions/:agentName/restart", async (req: Request, res: Response) => {
    try {
      const roomId = normalizeText(req.params.roomId, 120);
      const agentName = normalizeText(req.params.agentName, 120);

      if (!roomId || !agentName) {
        res.status(400).json({ success: false, error: "roomId and agentName are required" });
        return;
      }

      const result = await context.restartManualRoomSession(roomId, agentName, "manual room restart");
      const response: ApiResponse<LocalRoomSessionControlPayload> = {
        success: true,
        data: {
          started: result.started,
          alreadyRunning: result.alreadyRunning,
          localSessions: context.db.listRoomSessions(roomId)
        }
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  return router;
}
