import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runDeliveryBatch } from "../_notify/delivery.js";
import { NotifyError, type NotifyEnv, type RpcClient } from "../_notify/types.js";
import { getAuthorizationBearer, requirePost, sendJson } from "../_shared/http.js";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.js";

export const maxDuration = 60;

type AuthClient = RpcClient & {
  auth: { getUser(token: string): PromiseLike<{ data: { user: unknown }; error: unknown }> };
};

// 操作后立即发送：页面在写入成功后调用，这样免费部署也不用每分钟跑定时任务。
// 只发送队列里已有的消息，调用方不能指定内容，所以任何已登录用户都可以触发。
export function createFlushHandler(options: { env?: NotifyEnv; getClient?: () => AuthClient; fetchImpl?: typeof fetch } = {}) {
  return async (request: VercelRequest, response: VercelResponse) => {
    if (!requirePost(request, response)) return;
    const token = getAuthorizationBearer(request);
    if (!token) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    try {
      const client = options.getClient?.() ?? (getSupabaseAdmin() as unknown as AuthClient);
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }
      const result = await runDeliveryBatch(client, options.env ?? process.env, { fetchImpl: options.fetchImpl });
      sendJson(response, 200, { sent: result.sent, failed: result.failed });
    } catch (error) {
      sendJson(response, error instanceof NotifyError ? error.status : 503, { error: "Notification delivery unavailable" });
    }
  };
}

export default createFlushHandler();
