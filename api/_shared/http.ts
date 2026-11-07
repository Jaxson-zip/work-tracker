import { createHash, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export function sendJson(response: VercelResponse, statusCode: number, payload: unknown): void {
  response.status(statusCode).setHeader("content-type", "application/json; charset=utf-8").json(payload);
}

export function requirePost(request: VercelRequest, response: VercelResponse): boolean {
  if (request.method === "POST") return true;
  response.setHeader("allow", "POST");
  sendJson(response, 405, { error: "Method not allowed" });
  return false;
}

export function getAuthorizationBearer(request: VercelRequest): string | null {
  const value = request.headers.authorization;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

// 比较摘要而不是原文，这样长度不同也不会提前返回。
export function equalSecret(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}
