import { buildRequestBody, isDelivered, parseDestination, type Destination } from "./channels.js";
import { NotifyError, type NotifyEnv, type RpcClient } from "./types.js";

type Claimed = {
  id: string;
  workspace_id: string;
  payload: { message?: unknown };
  mentions: string[];
  claim_token: string;
  attempts: number;
};

// 群机器人限 20 条/分钟，一批最多发 15 条，其余留给下一次。
const BATCH_SIZE = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function destinations(env: NotifyEnv): Map<string, Destination> {
  try {
    const parsed = JSON.parse(env.WORKSPACE_WEBHOOKS ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) throw new Error();
    const result = new Map<string, Destination>();
    for (const [id, entry] of Object.entries(parsed)) {
      if (!UUID.test(id)) throw new Error();
      result.set(id.toLowerCase(), parseDestination(entry));
    }
    return result;
  } catch {
    throw new NotifyError(503, "Invalid webhook configuration");
  }
}

export function businessClock(now: Date, env: NotifyEnv): { date: string; hour: number } {
  const timeZone = env.APP_TIMEZONE || "Asia/Shanghai";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    throw new NotifyError(503, "Invalid time zone configuration");
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
}

function withLink(message: string, env: NotifyEnv): string {
  return env.APP_BASE_URL ? `${message}\n${env.APP_BASE_URL}` : message;
}

export async function runDeliveryBatch(
  client: RpcClient,
  env: NotifyEnv,
  options: { fetchImpl?: typeof fetch; now?: Date; digest?: boolean } = {},
) {
  // 先校验配置再认领，配置错误时消息留在队列里。URL、密钥和远端响应都不写入错误或数据库。
  const routes = destinations(env);
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const clock = businessClock(now, env);
  let enqueued = 0;
  if (options.digest && clock.hour >= Number(env.DIGEST_HOUR ?? 9)) {
    const queued = await client.rpc("wt_enqueue_digest", { p_today: clock.date });
    if (queued.error) throw new NotifyError(503, "Notification queue unavailable");
    enqueued = Number((queued.data as { enqueued?: number })?.enqueued ?? 0);
  }
  const claimed = await client.rpc("wt_claim_notifications", { p_limit: BATCH_SIZE, p_today: clock.date });
  if (claimed.error || !Array.isArray(claimed.data)) throw new NotifyError(503, "Notification claims unavailable");
  const result = { enqueued, claimed: claimed.data.length, sent: 0, failed: 0 };
  for (const row of claimed.data as Claimed[]) {
    let error: string | null = null;
    try {
      const destination = routes.get(row.workspace_id.toLowerCase());
      if (!destination) throw new Error("No webhook configured for this team");
      if (typeof row.payload?.message !== "string") throw new Error("Delivery failed");
      const response = await fetchImpl(destination.url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json; charset=utf-8" },
        body: buildRequestBody(destination, { text: withLink(row.payload.message, env), mentionMobiles: row.mentions ?? [], now }),
      });
      if (!response.ok || !isDelivered(destination, await response.json())) throw new Error("Delivery failed");
    } catch (cause) {
      error = cause instanceof Error && cause.message === "No webhook configured for this team" ? cause.message : "Delivery failed";
    }
    const finished = await client.rpc("wt_finish_notification", { p_id: row.id, p_claim_token: row.claim_token, p_error: error });
    if (finished.error) throw new NotifyError(503, "Notification receipt unavailable");
    if (error) result.failed++;
    else result.sent++;
  }
  return result;
}
