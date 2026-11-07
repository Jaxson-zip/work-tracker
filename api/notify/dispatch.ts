import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runDeliveryBatch } from "../_notify/delivery.js";
import { NotifyError, type NotifyEnv, type RpcClient } from "../_notify/types.js";
import { equalSecret, getAuthorizationBearer, sendJson } from "../_shared/http.js";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.js";

export const maxDuration = 60;

// 定时入口：生成每日摘要并补发失败的消息。Vercel Cron 用 GET 调用并带 CRON_SECRET，自建定时任务可以用 POST。
export function createDispatchHandler(
  options: { env?: NotifyEnv; getClient?: () => RpcClient; fetchImpl?: typeof fetch; now?: () => Date } = {},
) {
  return async (request: VercelRequest, response: VercelResponse) => {
    if (request.method !== "GET" && request.method !== "POST") {
      response.setHeader("allow", "GET, POST");
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    const env = options.env ?? process.env;
    if (!env.CRON_SECRET) {
      sendJson(response, 503, { error: "Notification dispatcher is not configured" });
      return;
    }
    if (!equalSecret(getAuthorizationBearer(request), env.CRON_SECRET)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    try {
      const client = options.getClient?.() ?? getSupabaseAdmin();
      sendJson(response, 200, await runDeliveryBatch(client, env, { fetchImpl: options.fetchImpl, now: options.now?.(), digest: true }));
    } catch (error) {
      sendJson(response, error instanceof NotifyError ? error.status : 503, {
        error: error instanceof NotifyError ? error.message : "Notification dispatcher unavailable",
      });
    }
  };
}

export default createDispatchHandler();
