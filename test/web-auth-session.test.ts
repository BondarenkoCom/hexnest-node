import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  clearNodeWebSession,
  createNodeWebAuthMiddleware,
  getNodeWebSessionToken,
  hasValidNodeWebSession,
  setNodeWebSession
} from "../src/web/auth-session.js";

function createRequest(cookie?: string): Request {
  return {
    headers: {
      cookie
    }
  } as Request;
}

function createResponse(): Response {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  } as unknown as Response;
}

describe("node web auth session", () => {
  it("reads the node session token from cookie header", () => {
    const req = createRequest("foo=bar; hexnest_node_session=session-token; hello=world");
    expect(getNodeWebSessionToken(req)).toBe("session-token");
  });

  it("validates a session token against stored user token", () => {
    const req = createRequest("hexnest_node_session=jwt-token");
    const db = {
      getNodeConfig: (key: string) => key === "user_token" ? "jwt-token" : null
    };

    expect(hasValidNodeWebSession(req, db as any)).toBe(true);
    expect(hasValidNodeWebSession(createRequest("hexnest_node_session=other"), db as any)).toBe(false);
  });

  it("sets and clears the auth session cookie", () => {
    const res = createResponse();
    setNodeWebSession(res, "jwt-token");
    clearNodeWebSession(res);

    expect(res.cookie).toHaveBeenCalledOnce();
    expect(res.clearCookie).toHaveBeenCalledOnce();
  });

  it("blocks unauthorized management requests", () => {
    const req = createRequest();
    const res = createResponse();
    const next = vi.fn();
    const middleware = createNodeWebAuthMiddleware({
      getNodeConfig: () => null
    } as any);

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "authentication required"
    });
  });
});