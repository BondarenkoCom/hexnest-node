import { Router, Request, Response } from "express";
import { HexNestClient } from "../../protocol/HexNestClient.js";
import type {
  AgentDescriptor,
  CoreRoomDetails,
  CoreRoomMessage,
  CreateCoreRoomInput,
  JoinRoomResponse
} from "../../protocol/types.js";
import type { WebServerContext } from "../server.js";
import { ApiResponse } from "../types.js";
import { resolveCoreUrl } from "../resolve-core-url.js";

interface LocalRoomsPayload {
  rooms: CoreRoomDetails[];
  availableAgents: AgentDescriptor[];
}

interface LocalRoomDetailPayload {
  room: CoreRoomDetails;
  messages: CoreRoomMessage[];
  availableAgents: AgentDescriptor[];
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
  return new HexNestClient(requireCoreUrl(context), {
    userToken: context.db.getNodeConfig("user_token") || undefined,
    timeoutMs: context.nodeConfig.httpTimeoutMs
  });
}

async function loadRoomDetail(context: WebServerContext, roomId: string): Promise<LocalRoomDetailPayload> {
  const client = createClient(context);
  const [room, messageResponse] = await Promise.all([
    client.getRoom(roomId),
    client.getRoomMessages(roomId, 80)
  ]);

  return {
    room,
    messages: messageResponse.messages,
    availableAgents: context.getAvailableAgents()
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
      const client = createClient(context);
      const list = await client.listRooms(80);
      const roomIds = list.value
        .slice()
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .map((room) => room.id);
      const rooms = await Promise.all(roomIds.map((roomId) => loadRoomSummary(context, roomId)));

      const response: ApiResponse<LocalRoomsPayload> = {
        success: true,
        data: {
          rooms,
          availableAgents: context.getAvailableAgents()
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

      const response: ApiResponse<JoinRoomResponse> = {
        success: true,
        data: joined
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
      const joinedAgentId = normalizeText(req.body?.joinedAgentId, 120);
      const text = normalizeText(req.body?.text, 4000);
      const confidence = typeof req.body?.confidence === "number" ? req.body.confidence : undefined;

      if (!roomId || !joinedAgentId || !text) {
        res.status(400).json({ success: false, error: "roomId, joinedAgentId and text are required" });
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

  return router;
}
