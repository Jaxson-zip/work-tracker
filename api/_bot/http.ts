import { timingSafeEqual } from "node:crypto";
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

export async function readJsonBody<T extends Record<string, unknown>>(request: VercelRequest): Promise<T> {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body as T;
  }

  if (typeof request.body === "string") {
    return JSON.parse(request.body) as T;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export function getAuthorizationBearer(request: VercelRequest): string | null {
  const authorization = getHeader(request, "authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export function getHeader(request: VercelRequest, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

export function hasValidBotSecret(request: VercelRequest, body?: Record<string, unknown>): boolean {
  const headerSecret = getHeader(request, "x-bot-secret");
  const bearerSecret = getAuthorizationBearer(request);
  const bodySecret = typeof body?.secret === "string" ? body.secret : null;
  return [headerSecret, bearerSecret, bodySecret].some((candidate) => isValidSharedSecret(candidate));
}

export function isValidSharedSecret(candidate: string | null | undefined): boolean {
  const expected = process.env.BOT_WEBHOOK_SECRET;
  if (!expected || !candidate) return false;

  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  if (expectedBuffer.length !== candidateBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, candidateBuffer);
}
