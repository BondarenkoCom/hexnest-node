import express, { Express, Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseService } from "../db/database.js";
import { NodeConfig } from "../config.js";
import { modelsRouter } from "./api/models.js";
import { adaptersRouter } from "./api/adapters.js";
import { configRouter } from "./api/config.js";
import { statusRouter } from "./api/status.js";
import { coreRouter } from "./api/core.js";
import { authRouter } from "./api/auth.js";
import { roomsRouter } from "./api/rooms.js";
import { createNodeWebAuthMiddleware } from "./auth-session.js";
import type { RuntimeActivityItem } from "../core/NodeRuntime.js";
import type { AgentDescriptor } from "../protocol/types.js";
import { resolvePublicDir } from "../runtime-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface WebServerContext {
  db: DatabaseService;
  nodeConfig: NodeConfig;
  reconnectToCore: (
    auth?: { userToken?: string; userEmail?: string }
  ) => Promise<{ coreUrl: string; coreConnected: boolean; nodeId: string | null }>;
  disconnectFromCore: () => Promise<{ coreUrl: string; coreConnected: boolean; nodeId: string | null }>;
  resetNodeIdentity: () => Promise<{ previousNodeId: string | null }>;
  removeNodeFromCore: () => Promise<{ removed: boolean; nodeId: string | null }>;
  refreshRuntimeAdapters: () => { adaptersCount: number };
  startManualRoomSession: (
    roomId: string,
    agentName: string,
    role: string,
    joinedAgentId: string,
    taskHint?: string
  ) => Promise<{ started: boolean; alreadyRunning: boolean }>;
  stopManualRoomSession: (
    roomId: string,
    agentName: string
  ) => Promise<{ stopped: boolean; hadActiveRun: boolean }>;
  restartManualRoomSession: (
    roomId: string,
    agentName: string,
    taskHint?: string
  ) => Promise<{ started: boolean; alreadyRunning: boolean }>;
  getRecentActivity: () => RuntimeActivityItem[];
  getAvailableAgents: () => AgentDescriptor[];
  getNodeStatus: () => {
    id: string | null;
    isRunning: boolean;
    uptime: number;
    adaptersCount: number;
    coreConnected: boolean;
    coreConnectionReason: string | null;
    runtimeStatus: "online" | "busy" | "draining" | "offline";
    heartbeatIntervalMs: number;
    lastHeartbeatAt: string | null;
    activeRoomsCount: number;
    pendingUsageRecords: number;
    actedCycles: number;
    noActionCycles: number;
    reentryWithoutProgress: number;
    actedRate: number;
    noActionRate: number;
    loopGuardEnabled: boolean;
    loopGuardRolloutPercent: number;
    loopGuardNoActionStreak: number;
    alertsMinCycles: number;
    alertsMaxNoActionRate: number;
    alertsMaxReentryRate: number;
  };
}

export function createWebServer(context: WebServerContext): Express {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // No-cache middleware for index.html (always fresh)
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/' || req.path === '/index.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  // Serve static files - resolve from project root
  const publicDir = resolvePublicDir();
  app.use(express.static(publicDir));

  // Public API routes
  app.use("/api/auth", authRouter(context));

  // Health check
  app.get("/api/health", (req: Request, res: Response) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // Protected management API routes
  app.use("/api", createNodeWebAuthMiddleware(context.db));
  app.use("/api/models", modelsRouter(context));
  app.use("/api/adapters", adaptersRouter(context));
  app.use("/api/config", configRouter(context));
  app.use("/api/status", statusRouter(context));
  app.use("/api/core", coreRouter(context));
  app.use("/api/rooms", roomsRouter(context));

  // Serve index.html for all other routes (SPA)
  app.get("*", (req: Request, res: Response) => {
    const indexPath = path.join(publicDir, "index.html");
    res.sendFile(indexPath, (err: Error | null) => {
      if (err) {
        res.status(404).send("Not found");
      }
    });
  });

  // Error handling
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error("[web] error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message || "Internal server error"
    });
  });

  return app;
}
export interface WebServerStartResult {
  host: string;
  port: number;
  url: string;
}

interface WebServerStartOptions {
  host?: string;
  allowPortFallback?: boolean;
}

function normalizeDisplayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host;
}

function listenOnce(app: Express, host: string, port: number): Promise<{ host: string; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);

    const cleanup = () => {
      server.removeListener("listening", onListening);
      server.removeListener("error", onError);
    };

    const onListening = () => {
      cleanup();
      const address = server.address() as AddressInfo | null;
      const actualPort = address?.port ?? port;
      resolve({ host, port: actualPort });
    };

    const onError = (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(error);
    };

    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(port, host);
  });
}

export async function startWebServer(
  app: Express,
  port: number = 3000,
  options: WebServerStartOptions = {}
): Promise<WebServerStartResult> {
  const host = (options.host || process.env.HEXNEST_WEB_HOST || "127.0.0.1").trim() || "127.0.0.1";
  const allowPortFallback = options.allowPortFallback ?? false;

  try {
    const started = await listenOnce(app, host, port);
    const url = `http://${normalizeDisplayHost(started.host)}:${started.port}`;
    console.log(`[hexnest-web] server running at ${url}`);
    return { host: started.host, port: started.port, url };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EADDRINUSE" && allowPortFallback && port !== 0) {
      const started = await listenOnce(app, host, 0);
      const url = `http://${normalizeDisplayHost(started.host)}:${started.port}`;
      console.warn(`[hexnest-web] preferred port ${port} is busy, switched to ${url}`);
      return { host: started.host, port: started.port, url };
    }
    if (err.code === "EADDRINUSE") {
      throw new Error(
        `Port ${port} is already in use. Set HEXNEST_WEB_PORT to 0 for an automatic port or choose a free port and restart.`
      );
    }
    throw error;
  }
}


