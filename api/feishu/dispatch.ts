import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthorizationBearer, requirePost, sendJson } from '../_bot/http.js';
import { getSupabaseAdmin } from '../_bot/supabaseAdmin.js';
import { equalSecret } from '../_feishu/callback.js';
import { runDeliveryBatch } from '../_feishu/delivery.js';
import { FeishuError, type FeishuEnv, type RpcClient } from '../_feishu/types.js';

export const maxDuration = 300;

export function createDispatchHandler(options: { env?: FeishuEnv; getClient?: () => RpcClient; fetchImpl?: typeof fetch } = {}) {
  return async (request: VercelRequest, response: VercelResponse) => {
    if (!requirePost(request, response)) return;
    const env = options.env ?? process.env;
    if (!env.CRON_SECRET) { sendJson(response, 503, { error: 'Notification dispatcher is not configured' }); return; }
    if (!equalSecret(getAuthorizationBearer(request), env.CRON_SECRET)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
    try {
      const result = await runDeliveryBatch(options.getClient?.() ?? getSupabaseAdmin(), env, options.fetchImpl ?? fetch);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, error instanceof FeishuError ? error.status : 503, { error: error instanceof FeishuError ? error.message : 'Notification dispatcher unavailable' });
    }
  };
}

export default createDispatchHandler();
