import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function bearer(token: string): string {
  return `Bearer ${token}`;
}

export function sanitizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
