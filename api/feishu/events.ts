import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requirePost, sendJson } from "../_shared/http.js";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.js";
import { authenticateCallback } from "../_feishu/callback.js";
import { parseFeishuCommand } from "../_feishu/commands.js";
import { NotifyError, type NotifyEnv, type RpcClient } from "../_notify/types.js";

export const config = { api: { bodyParser: false } };

export function createEventsHandler(options: { env?: NotifyEnv; now?: () => Date; getClient?: () => RpcClient } = {}) {
  return async (request: VercelRequest, response: VercelResponse) => {
    if (!requirePost(request, response)) return;
    try {
      const env = options.env ?? process.env;
      const now = options.now?.() ?? new Date();
      const payload = await authenticateCallback(request, env, now);
      if (payload.type === "url_verification" && typeof payload.challenge === "string") {
        sendJson(response, 200, { challenge: payload.challenge });
        return;
      }
      const sender = payload.event?.sender;
      const message = payload.event?.message;
      if (
        payload.schema === "2.0" &&
        payload.header?.event_type === "im.message.receive_v1" &&
        sender?.sender_type === "user" &&
        message?.message_type === "text" &&
        message?.chat_type === "p2p"
      ) {
        let text: unknown;
        try {
          text = JSON.parse(message.content).text;
        } catch {
          throw new NotifyError(400, "Invalid message content");
        }
        const openId = sender.sender_id?.open_id;
        const eventId = payload.header.event_id;
        const messageId = message.message_id;
        if (
          typeof text !== "string" ||
          typeof openId !== "string" ||
          !openId ||
          typeof eventId !== "string" ||
          !eventId ||
          typeof messageId !== "string" ||
          !messageId
        )
          throw new NotifyError(400, "Invalid message event");
        const command = parseFeishuCommand(text, now, env);
        if (command) {
          const client = options.getClient?.() ?? getSupabaseAdmin();
          // The stable message id also deduplicates redeliveries with a new event id.
          const result = await client.rpc("wt_ingest_feishu", {
            p_event_id: `message:${messageId}`,
            p_open_id: openId,
            p_payload: command,
          });
          if (result.error) throw new NotifyError(503, "Feishu ingestion unavailable");
          sendJson(response, 200, { ok: true });
          return;
        }
      }
      sendJson(response, 200, { ignored: true });
    } catch (error) {
      sendJson(response, error instanceof NotifyError ? error.status : 503, {
        error: error instanceof NotifyError ? error.message : "Feishu callback unavailable",
      });
    }
  };
}

export default createEventsHandler();
