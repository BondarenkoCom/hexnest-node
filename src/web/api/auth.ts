import { Router, Request, Response } from "express";
import { HexNestClient } from "../../protocol/HexNestClient.js";
import { WebServerContext } from "../server.js";
import { mapUpstreamError } from "./upstream-errors.js";

export function authRouter(context: WebServerContext): Router {
  const router = Router();

  router.post("/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ success: false, error: "Email and password required" });
        return;
      }

      // Authenticate with core server
      const coreUrl = context.nodeConfig.coreUrl;
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

      res.json({
        success: true,
        message: "Logged in successfully",
        userId: authResponse.userId,
        token: authResponse.token,
        email
      });
    } catch (error) {
      const mapped = mapUpstreamError(error, "login", context.nodeConfig.coreUrl);
      console.error("[auth] login error:", mapped.message);
      res.status(mapped.status).json({
        success: false,
        error: mapped.message
      });
    }
  });

  router.post("/register", async (req: Request, res: Response) => {
    try {
      const { name, nodeName, email, password } = req.body;
      if (!name || !nodeName || !email || !password) {
        res.status(400).json({ success: false, error: "Name, node name, email and password required" });
        return;
      }

      // Register with core server
      const coreUrl = context.nodeConfig.coreUrl;
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

      res.json({
        success: true,
        message: "Account created successfully",
        userId: authResponse.userId,
        token: authResponse.token,
        email,
        nodeName
      });
    } catch (error) {
      const mapped = mapUpstreamError(error, "registration", context.nodeConfig.coreUrl);
      console.error("[auth] register error:", mapped.message);
      res.status(mapped.status).json({
        success: false,
        error: mapped.message
      });
    }
  });

  return router;
}
