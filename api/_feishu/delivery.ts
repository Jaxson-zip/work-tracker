import { createHmac } from 'node:crypto';
import { FeishuError, type FeishuEnv, type RpcClient } from './types.js';

type Destination = { url: string; secret: string };
type Claimed = { id: string; workspace_id: string; payload: { title: string; message: string }; claim_token: string; attempts: number };

function destinations(env: FeishuEnv): Map<string, Destination> {
  try {
    const parsed = JSON.parse(env.FEISHU_WORKSPACE_WEBHOOKS ?? '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) throw new Error();
    const result = new Map<string, Destination>();
    for (const [id, entry] of Object.entries(parsed)) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error();
      const destination = entry as Destination;
      if (typeof destination?.url !== 'string' || typeof destination.secret !== 'string' || !destination.secret.trim()) throw new Error();
      const url = new URL(destination.url);
      if (url.protocol !== 'https:' || !['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error();
      result.set(id.toLowerCase(), { url: url.href, secret: destination.secret });
    }
    return result;
  } catch { throw new FeishuError(503, 'Invalid Feishu webhook configuration'); }
}

export async function runDeliveryBatch(client: RpcClient, env: FeishuEnv, fetchImpl: typeof fetch = fetch) {
  // Validate every route before claiming anything. Never include URLs, secrets or
  // remote error bodies in exceptions, database failures, or application logs.
  const routes = destinations(env);
  const queued = await client.rpc('wt_enqueue_due');
  if (queued.error) throw new FeishuError(503, 'Notification queue unavailable');
  const claimed = await client.rpc('wt_claim_notifications', { p_limit: 20 });
  if (claimed.error || !Array.isArray(claimed.data)) throw new FeishuError(503, 'Notification claims unavailable');
  const result = { enqueued: Number((queued.data as { enqueued?: number })?.enqueued ?? 0), claimed: claimed.data.length, sent: 0, failed: 0 };
  for (const row of claimed.data as Claimed[]) {
    let error: string | null = null;
    try {
      const destination = routes.get(row.workspace_id.toLowerCase());
      if (!destination) throw new Error();
      if (typeof row.payload?.title !== 'string' || typeof row.payload?.message !== 'string') throw new Error();
      const timestamp = String(Math.floor(Date.now() / 1000));
      const sign = createHmac('sha256', `${timestamp}\n${destination.secret}`).update('').digest('base64');
      const response = await fetchImpl(destination.url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ timestamp, sign, msg_type: 'text', content: { text: `${row.payload.title}\n${row.payload.message}` } }),
      });
      if (!response.ok || (await response.json())?.code !== 0) throw new Error();
    } catch { error = 'Feishu delivery failed'; }
    const finished = await client.rpc('wt_finish_notification', { p_id: row.id, p_claim_token: row.claim_token, p_error: error });
    if (finished.error) throw new FeishuError(503, 'Notification receipt unavailable');
    if (error) result.failed++; else result.sent++;
  }
  return result;
}
