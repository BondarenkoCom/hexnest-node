import { describe, expect, it } from "vitest";
import { CoreApiError } from "../src/protocol/HexNestClient.js";
import { mapUpstreamError } from "../src/web/api/upstream-errors.js";

describe("mapUpstreamError", () => {
  it("maps network failures to 503 instead of 401", () => {
    const error = new CoreApiError(
      "Core API is unreachable at http://localhost:10000/api/auth/login",
      "network",
      { path: "/api/auth/login", url: "http://localhost:10000/api/auth/login" }
    );

    expect(mapUpstreamError(error, "login", "http://localhost:10000")).toEqual({
      status: 503,
      message: "Core API is unreachable during login. Check whether the core server is running at http://localhost:10000."
    });
  });

  it("maps upstream 5xx to 502 and preserves a concise message", () => {
    const error = new CoreApiError(
      "Core API failed 502 Bad Gateway: upstream returned HTML instead of JSON",
      "http",
      {
        status: 502,
        statusText: "Bad Gateway",
        contentType: "text/html",
        body: "<!DOCTYPE html><html></html>",
        path: "/api/auth/login",
        url: "http://localhost:10000/api/auth/login"
      }
    );

    expect(mapUpstreamError(error, "login", "http://localhost:10000")).toEqual({
      status: 502,
      message: "Core API is unavailable during login: Core API failed 502 Bad Gateway: upstream returned HTML instead of JSON"
    });
  });

  it("preserves auth errors from upstream", () => {
    const error = new CoreApiError(
      "Core API failed 401 Unauthorized: invalid credentials",
      "http",
      {
        status: 401,
        statusText: "Unauthorized",
        contentType: "application/json",
        body: '{"error":"invalid credentials"}'
      }
    );

    expect(mapUpstreamError(error, "login", "http://localhost:10000")).toEqual({
      status: 401,
      message: "invalid credentials"
    });
  });

  it("preserves concise validation messages from upstream json bodies", () => {
    const error = new CoreApiError(
      "Core API failed 409 Conflict: email already registered",
      "http",
      {
        status: 409,
        statusText: "Conflict",
        contentType: "application/json",
        body: '{"error":"email already registered","code":"already_exists"}'
      }
    );

    expect(mapUpstreamError(error, "registration", "http://localhost:10000")).toEqual({
      status: 409,
      message: "email already registered"
    });
  });
});