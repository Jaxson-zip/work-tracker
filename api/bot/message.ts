import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseBotIntent } from "../_bot/intent.js";
import { hasValidBotSecret, readJsonBody, requirePost, sendJson } from "../_bot/http.js";
import { handleBoundIntent } from "../_bot/messageProcessor.js";
import { getSupabaseAdmin } from "../_bot/supabaseAdmin.js";
import { bindProviderUser, getBotBinding } from "../_bot/todoRepository.js";

type BotMessagePayload = {
  senderId?: string;
  userId?: string;
  from?: string;
  openid?: string;
  openId?: string;
  text?: string;
  message?: string;
  content?: string;
  secret?: string;
};

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (!requirePost(request, response)) return;

  let payload: BotMessagePayload;
  try {
    payload = await readJsonBody<BotMessagePayload>(request);
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!hasValidBotSecret(request, payload)) {
    sendJson(response, 401, { error: "Invalid bot secret" });
    return;
  }

  const senderId = getSenderId(payload);
  const text = getMessageText(payload);
  if (!senderId || !text) {
    sendJson(response, 400, { error: "Missing sender id or message text" });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const intent = parseBotIntent(text);

    if (intent.type === "bind") {
      const result = await bindProviderUser(supabase, senderId, intent.code);
      sendJson(response, 200, {
        reply: result === "bound" ? "绑定成功，以后微信消息会同步到你的待办账号。" : "绑定码无效或已过期，请在网站重新生成。",
      });
      return;
    }

    const binding = await getBotBinding(supabase, senderId);
    if (!binding) {
      sendJson(response, 200, { reply: "" });
      return;
    }

    const reply = await handleBoundIntent(supabase, binding.user_id, senderId, intent);
    sendJson(response, 200, { reply });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Bot message failed" });
  }
}

function getSenderId(payload: BotMessagePayload): string | null {
  return firstString(payload.senderId, payload.userId, payload.from, payload.openid, payload.openId);
}

function getMessageText(payload: BotMessagePayload): string | null {
  return firstString(payload.text, payload.message, payload.content);
}

function firstString(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}
