import { Router, Request, Response } from "express";
import { HexNestClient } from "../../protocol/HexNestClient.js";
import { WebServerContext } from "../server.js";
import { mapUpstreamError } from "./upstream-errors.js";
import {
  clearNodeWebSession,
  hasValidNodeWebSession,
  setNodeWebSession
} from "../auth-session.js";
import { resolveCoreUrl, resolveReachableCoreUrl } from "../resolve-core-url.js";

async function reconnectNodeAfterAuth(
  context: WebServerContext,
  userToken: string,
  userEmail: string
): Promise<{ coreUrl: string; coreConnected: boolean; nodeId: string | null; coreConnectionError?: string }> {
  try {
    resolveCoreUrl(context);
    return await context.reconnectToCore({ userToken, userEmail });
  } catch (error) {
    return {
      coreUrl: resolveCoreUrl(context),
      coreConnected: false,
      nodeId: null,
      coreConnectionError: error instanceof Error ? error.message : "Failed to connect node to core"
    };
  }
}

export function authRouter(context: WebServerContext): Router {
  const router = Router();

  router.post("/login", async (req: Request, res: Response) => {
    let coreUrl = resolveCoreUrl(context);
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ success: false, error: "Email and password required" });
        return;
      }

      // Authenticate with core server
      coreUrl = await resolveReachableCoreUrl(context);
      if (!coreUrl) {
        res.status(500).json({ success: false, error: "Core connection is not configured in node settings" });
        return;
      }

      console.log("[auth] Attempting login for", email, "at", coreUrl);
      const client = new HexNestClient(coreUrl);
      const authResponse = await client.loginUser({ email, password });
      console.log("[auth] Login successful for", email, "userId:", authResponse.userId);

      // Save token to database instead of .env
      context.db.setNodeConfig("user_email", email);
      context.db.setNodeConfig("user_token", authResponse.token);
      setNodeWebSession(res, authResponse.token);
      const connection = await reconnectNodeAfterAuth(context, authResponse.token, email);

      res.json({
        success: true,
        message: "Logged in successfully",
        userId: authResponse.userId,
        email,
        coreUrl: connection.coreUrl,
        coreConnected: connection.coreConnected,
        nodeId: connection.nodeId,
        coreConnectionError: connection.coreConnectionError
      });
    } catch (error) {
      const mapped = mapUpstreamError(error, "login", coreUrl);
      console.error("[auth] login error:", mapped.message);
      res.status(mapped.status).json({
        success: false,
        error: mapped.message
      });
    }
  });

  router.post("/register", async (req: Request, res: Response) => {
    let coreUrl = resolveCoreUrl(context);
    try {
      const { name, nodeName, email, password } = req.body;
      if (!name || !nodeName || !email || !password) {
        res.status(400).json({ success: false, error: "Name, node name, email and password required" });
        return;
      }

      // Register with core server
      coreUrl = await resolveReachableCoreUrl(context);
      if (!coreUrl) {
        res.status(500).json({ success: false, error: "Core connection is not configured in node settings" });
        return;
      }

      const client = new HexNestClient(coreUrl);
      const authResponse = await client.registerUser({ name, email, password });

      // Save config to database instead of .env
      context.db.setNodeConfig("operator_name", name);
      context.db.setNodeConfig("node_name", nodeName);
      context.db.setNodeConfig("user_email", email);
      context.db.setNodeConfig("user_token", authResponse.token);
      setNodeWebSession(res, authResponse.token);
      const connection = await reconnectNodeAfterAuth(context, authResponse.token, email);

      res.json({
        success: true,
        message: "Account created successfully",
        userId: authResponse.userId,
        email,
        nodeName,
        coreUrl: connection.coreUrl,
        coreConnected: connection.coreConnected,
        nodeId: connection.nodeId,
        coreConnectionError: connection.coreConnectionError
      });
    } catch (error) {
      const mapped = mapUpstreamError(error, "registration", coreUrl);
      console.error("[auth] register error:", mapped.message);
      res.status(mapped.status).json({
        success: false,
        error: mapped.message
      });
    }
  });

  router.get("/session", (req: Request, res: Response) => {
    const authenticated = hasValidNodeWebSession(req, context.db);
    res.json({
      success: true,
      authenticated,
      email: authenticated ? context.db.getNodeConfig("user_email") : null
    });
  });

  router.post("/logout", (_req: Request, res: Response) => {
    clearNodeWebSession(res);
    res.json({
      success: true,
      message: "Logged out successfully"
    });
  });

  return router;
}
