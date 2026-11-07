export default async function handleTodoWechatMessage(event) {
  if (!Array.isArray(event.messages)) event.messages = [];
  const context = event?.context ?? {};
  const channelId = firstString(context.channelId, context.channel, context.metadata?.channelId);
  if (!isAllowedChannel(channelId)) return;

  const text = firstString(context.content, context.text, context.message, context.metadata?.content);
  if (!text) return;

  const senderId = getSenderId(context);
  if (!senderId) {
    event.messages.push("我没有识别到这个微信会话，先换成私聊再试一次。");
    return;
  }

  try {
    const reply = await forwardToTodoBot({ senderId, text });
    if (reply) event.messages.push(reply);
  } catch (error) {
    console.error("[todo-wechat] message bridge failed", error);
    event.messages.push("待办服务暂时没有连上，稍后再试一次。");
  }
}

export async function onMessageReceived(event) {
  return handleTodoWechatMessage(event);
}

async function forwardToTodoBot(payload) {
  const baseUrl = requiredEnv("TODO_BOT_BASE_URL").replace(/\/+$/g, "");
  const secret = requiredEnv("TODO_BOT_SECRET");
  const timeoutMs = Number(process.env.TODO_BOT_TIMEOUT_MS ?? 12_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 12_000);

  try {
    const response = await fetch(`${baseUrl}/api/bot/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-secret": secret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Todo API returned ${response.status}`);
    return typeof body.reply === "string" ? body.reply.trim() : "";
  } finally {
    clearTimeout(timer);
  }
}

function getSenderId(context) {
  const metadata = context.metadata ?? {};
  return firstString(
    metadata.senderId,
    metadata.userId,
    metadata.openid,
    metadata.openId,
    context.from,
    context.senderId,
    context.userId,
    context.conversationId,
    context.threadId,
    context.sessionKey
  );
}

function isAllowedChannel(channelId) {
  const allowed = (process.env.TODO_BOT_ALLOWED_CHANNELS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.length === 0 || !channelId || allowed.includes(channelId);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}
