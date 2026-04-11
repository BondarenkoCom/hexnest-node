import { CoreApiError, isCoreApiError } from "../../protocol/HexNestClient.js";

export interface UpstreamHttpError {
  status: number;
  message: string;
}

function formatAction(action: string): string {
  return action.trim() || "request";
}

function extractUserFacingMessage(error: CoreApiError): string | null {
  const body = String(error.details.body || "").trim();
  if (!body) {
    return null;
  }

  const contentType = String(error.details.contentType || "").toLowerCase();
  const looksLikeJson =
    contentType.includes("application/json")
    || body.startsWith("{")
    || body.startsWith("[");

  if (!looksLikeJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const message = parsed.error ?? parsed.message;
    return typeof message === "string" && message.trim() ? message.trim() : null;
  } catch {
    return null;
  }
}

export function mapUpstreamError(error: unknown, action: string, coreUrl: string): UpstreamHttpError {
  const safeAction = formatAction(action);

  if (!isCoreApiError(error)) {
    return {
      status: 500,
      message: error instanceof Error ? error.message : `Unknown ${safeAction} error`
    };
  }

  if (error.kind === "timeout") {
    return {
      status: 504,
      message: `Core API timeout during ${safeAction}. Check whether the core server is running at ${coreUrl}.`
    };
  }

  if (error.kind === "network") {
    return {
      status: 503,
      message: `Core API is unreachable during ${safeAction}. Check whether the core server is running at ${coreUrl}.`
    };
  }

  if (error.kind === "invalid-response") {
    return {
      status: 502,
      message: `Core API returned an invalid response during ${safeAction}.`
    };
  }

  const status = error.details.status ?? 500;
  if (status >= 500) {
    return {
      status: 502,
      message: `Core API is unavailable during ${safeAction}: ${error.message}`
    };
  }

  const userFacingMessage = extractUserFacingMessage(error);
  if (userFacingMessage) {
    return {
      status,
      message: userFacingMessage
    };
  }

  return {
    status,
    message: error.message
  };
}

export { CoreApiError };