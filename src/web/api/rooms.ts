import { Router, Request, Response } from "express";
import { HexNestClient } from "../../protocol/HexNestClient.js";
import type {
  AgentDescriptor,
  CoreRoomConnectBrief,
  CoreRoomDetails,
  CoreRoomSnapshot,
  CoreRoomStats,
  CreateCoreRoomInput,
  JoinRoomResponse
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


interface LocalJoinSelfPayload {
  joinedAgent: JoinRoomResponse["agent"];
  roomSessionStarted: boolean;
  roomSessionAlreadyRunning: boolean;
  roomSessionAutonomous: boolean;
  warning?: string;
}

function normalizeText(value: unknown, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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
          availableAgents: context.getAvailableAgents()
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
      const task = normalizeText(req.body?.task, 4000);
      if (!task) {
        res.status(400).json({ success: false, error: "task is required" });
        return;
      }

      const payload: CreateCoreRoomInput = {
        name: normalizeText(req.body?.name, 120) || undefined,
        task,
        subnest: normalizeText(req.body?.subnest, 40) || undefined,
        pythonShellEnabled: normalizeBoolean(req.body?.pythonShellEnabled, false),
        webSearchEnabled: normalizeBoolean(req.body?.webSearchEnabled, true),
        marketDataEnabled: normalizeBoolean(req.body?.marketDataEnabled, false)
      };

      const client = createClient(context);
      const room = await client.createRoom(payload);

      const response: ApiResponse<CoreRoomDetails> = {
        success: true,
        data: room
      };
      res.status(201).json(response);
    } catch (error) {
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
      const role = normalizeText(req.body?.role, 80);

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
      const joined = await client.joinRoom(roomId, agentName, role);

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
            role,
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

      if (!roomId || !joinedAgentId || !text) {
        res.status(400).json({ success: false, error: "roomId, agentId/joinedAgentId and text are required" });
        return;
      }

      const client = createClient(context);
      await client.postRoomMessage({ roomId, joinedAgentId, text, confidence });
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
