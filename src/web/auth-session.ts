import { Request, Response, NextFunction } from "express";
import { DatabaseService } from "../db/database.js";

export const NODE_WEB_SESSION_COOKIE = "hexnest_node_session";

function parseCookies(header: string | undefined): Record<string, string> {
  const raw = String(header || "").trim();
  if (!raw) {
    return {};
  }

  return Object.fromEntries(
    raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex === -1) {
          return [part, ""];
        }
        const key = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        return [key, decodeURIComponent(value)];
      })
  );
}

export function getNodeWebSessionToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[NODE_WEB_SESSION_COOKIE];
  return token ? token.trim() : null;
}

export function hasValidNodeWebSession(req: Request, db: DatabaseService): boolean {
  const sessionToken = getNodeWebSessionToken(req);
  const storedToken = db.getNodeConfig("user_token");
  return Boolean(sessionToken && storedToken && sessionToken === storedToken.trim());
}

export function setNodeWebSession(res: Response, token: string): void {
  res.cookie(NODE_WEB_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/"
  });
}

export function clearNodeWebSession(res: Response): void {
  res.clearCookie(NODE_WEB_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/"
  });
}

export function createNodeWebAuthMiddleware(db: DatabaseService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (hasValidNodeWebSession(req, db)) {
      next();
      return;
    }

    res.status(401).json({
      success: false,
      error: "authentication required"
    });
  };
}