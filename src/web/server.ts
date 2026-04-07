import express, { Express, Request, Response, NextFunction } from "express";
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
import { createNodeWebAuthMiddleware } from "./auth-session.js";
import type { RuntimeActivityItem } from "../core/NodeRuntime.js";

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
  getRecentActivity: () => RuntimeActivityItem[];
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
  const publicDir = path.resolve(process.cwd(), "public");
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

export async function startWebServer(app: Express, port: number = 3000): Promise<void> {
  return new Promise((resolve) => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`[hexnest-web] server running at http://0.0.0.0:${port}`);
      resolve();
    });
  });
}
