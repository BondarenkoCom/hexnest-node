import fs from "node:fs";
import path from "node:path";
import express, { NextFunction, Request, Response } from "express";
import { resolvePackageRoot } from "../runtime-paths.js";
import { logDiscoveryFetch } from "./discovery-telemetry.js";
import type { WebServerContext } from "./server.js";

const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60_000;

const STATIC_SKILLS = [
  {
    id: "mrn.describe",
    name: "Describe node",
    description: "Returns live description of this node, its agents, capabilities, and status.",
    tags: ["mrn", "discovery", "introspection"],
    examples: [
      "What agents are available on this node?",
      "このノードで利用可能なエージェントは？",
      "这个节点上有哪些可用的 agent？"
    ]
  },
  {
    id: "mrn.reason",
    name: "Multi-agent reasoning",
    description:
      "Participates in structured multi-agent reasoning rooms via HexNest core. Agents take roles (expert, critic, synthesizer) and produce critiqued conclusions.",
    tags: ["mrn", "reasoning", "debate", "critique"],
    examples: [
      "Debate pros and cons of a technical decision",
      "技術的な決定の賛否を議論する",
      "辩论某个技术决策的利弊"
    ]
  },
  {
    id: "mrn.peer_exchange",
    name: "Peer exchange",
    description:
      "Declares node willingness to participate in inter-node reasoning exchanges. Current exchange transport is room-based via HexNest core.",
    tags: ["mrn", "mesh", "peer"],
    examples: [
      "Invite this node to a reasoning room",
      "このノードを推論ルームに招待する",
      "邀请此节点加入推理房间"
    ]
  }
] as const;

interface PackageJsonShape {
  version?: string;
}

function readPackageVersion(): string {
  try {
    const packageJsonPath = path.join(resolvePackageRoot(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJsonShape;
    return String(packageJson.version || "").trim() || "0.1.0";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[a2a-discovery] failed to read package version: ${message}`);
    return "0.1.0";
  }
}

const packageVersion = readPackageVersion();

function buildPublicUrl(req: Request): string {
  const configuredUrl = String(process.env.HEXNEST_PUBLIC_URL || "").trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  return req.socket.localPort
    ? `http://${req.hostname}:${req.socket.localPort}`
    : `http://${req.hostname}`;
}

function buildAgentCard(req: Request, context: WebServerContext) {
  const nodeStatus = context.getNodeStatus();

  return {
    protocolVersion: "1.0",
    name: "HexNest Reference Node",
    description:
      "Reference node of HexNest — a public mesh for machine reasoning. Runs locally or on your infra. Joins the mesh by publishing its agent card.",
    provider: {
      organization: process.env.HEXNEST_OPERATOR_NAME || "BondarenkoCom",
      url: "https://github.com/BondarenkoCom/hexnest-node"
    },
    url: buildPublicUrl(req),
    version: packageVersion,
    documentationUrl: "https://github.com/BondarenkoCom/hexnest-node#readme",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    securitySchemes: {},
    skills: STATIC_SKILLS,
    metadata: {
      node: {
        status: nodeStatus.runtimeStatus,
        runtimeStatus: nodeStatus.runtimeStatus,
        nodeId: nodeStatus.id,
        uptime: nodeStatus.uptime,
        adaptersCount: nodeStatus.adaptersCount,
        coreConnected: nodeStatus.coreConnected
      },
      availableAgents: context.getAvailableAgents().map((agent) => ({
        name: agent.name,
        capabilities: agent.capabilities,
        supportedRoles: agent.supportedRoles,
        protocol: agent.protocol
      }))
    }
  };
}

function writeCardResponse(
  req: Request,
  res: Response,
  context: WebServerContext,
  kind: "agent-card" | "agent-compat"
): void {
  logDiscoveryFetch(req, kind);
  res.setHeader("Cache-Control", "public, max-age=60");
  res.type("application/json");
  res.json(buildAgentCard(req, context));
}

export function wellKnownRouter(context: WebServerContext): express.Router {
  const router = express.Router();
  const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
  let nextCleanupAt = 0;

  router.use((req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now >= nextCleanupAt) {
      for (const [ip, bucket] of rateLimitBuckets.entries()) {
        if (bucket.resetAt <= now) {
          rateLimitBuckets.delete(ip);
        }
      }
      nextCleanupAt = now + RATE_LIMIT_CLEANUP_INTERVAL_MS;
    }

    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const bucket = rateLimitBuckets.get(ip);

    if (!bucket || bucket.resetAt <= now) {
      rateLimitBuckets.set(ip, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS
      });
      next();
      return;
    }

    if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: "too many discovery requests"
      });
      return;
    }

    bucket.count += 1;
    next();
  });

  router.get("/agent-card.json", (req: Request, res: Response) => {
    writeCardResponse(req, res, context, "agent-card");
  });

  router.get("/agent.json", (req: Request, res: Response) => {
    writeCardResponse(req, res, context, "agent-compat");
  });

  return router;
}
