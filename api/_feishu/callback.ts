import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { getHeader } from '../_bot/http.js';
import { FeishuError, type FeishuEnv } from './types.js';

export function equalSecret(actual: string | null | undefined, expected: string | undefined): boolean {
  if (typeof actual !== 'string' || !actual || !expected) return false;
  const a = createHash('sha256').update(actual).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function authenticateCallback(request: VercelRequest, env: FeishuEnv, now: Date): Promise<Record<string, any>> {
  const key = env.FEISHU_ENCRYPT_KEY;
  const token = env.FEISHU_VERIFICATION_TOKEN;
  if (!key || !token) throw new FeishuError(503, 'Feishu callback is not configured');
  const timestamp = getHeader(request, 'x-lark-request-timestamp');
  const nonce = getHeader(request, 'x-lark-request-nonce');
  const signature = getHeader(request, 'x-lark-signature');
  if (!timestamp || !/^\d{10,11}$/.test(timestamp) || !nonce || nonce.length > 256 || !signature || !/^[a-fA-F0-9]{64}$/.test(signature) || Math.abs(now.getTime() / 1000 - Number(timestamp)) > 300) {
    throw new FeishuError(401, 'Invalid Feishu callback authentication');
  }
  // Never reconstruct JSON for signing. Reject already-parsed bodies to fail closed.
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) throw new FeishuError(400, 'Raw callback body required');
  const chunks: Buffer[] = [];
  let length = 0;
  const append = (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1024 * 1024) throw new FeishuError(413, 'Callback too large');
    chunks.push(buffer);
  };
  if (typeof request.body === 'string' || Buffer.isBuffer(request.body)) append(request.body);
  else for await (const chunk of request) append(chunk);
  const raw = Buffer.concat(chunks);
  const expected = createHash('sha256').update(timestamp + nonce + key).update(raw).digest('hex');
  if (!equalSecret(signature.toLowerCase(), expected)) throw new FeishuError(401, 'Invalid Feishu callback authentication');
  let payload: Record<string, any>;
  try {
    const envelope = JSON.parse(raw.toString('utf8'));
    if (typeof envelope.encrypt !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.encrypt)) throw new Error();
    const encrypted = Buffer.from(envelope.encrypt, 'base64');
    if (encrypted.length < 32 || encrypted.length % 16 !== 0) throw new Error();
    const decipher = createDecipheriv('aes-256-cbc', createHash('sha256').update(key).digest(), encrypted.subarray(0, 16));
    payload = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(16)), decipher.final()]).toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
  } catch { throw new FeishuError(400, 'Invalid encrypted callback'); }
  const providedToken = payload.schema ? payload.header?.token : payload.token;
  if (!equalSecret(providedToken, token)) throw new FeishuError(401, 'Invalid Feishu callback authentication');
  return payload;
}
