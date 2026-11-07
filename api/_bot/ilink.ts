import { randomInt, randomUUID } from "node:crypto";
import QRCode from "qrcode";

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
export const ILINK_CHANNEL_VERSION = "1.0.2";

export type IlinkQrCode = {
  qrcodeId: string;
  qrcodeImage: string;
  expiresInSeconds: number;
};

export type IlinkQrStatus =
  | { status: "pending" | "scanned" | "expired" }
  | { status: "confirmed"; botToken: string; baseUrl: string };

export type IlinkCredentials = {
  botToken: string;
  baseUrl: string;
  wechatUin: string;
};

export type IlinkInboundMessage = {
  fromUserId: string;
  text: string;
  contextToken: string;
};

export type IlinkPollResult = {
  cursor: string;
  messages: IlinkInboundMessage[];
};

export type IlinkSendResult =
  | { status: "sent" }
  | { status: "context_expired" }
  | { status: "failed"; reason: string };

type IlinkSendBodyInput = {
  toUserId: string;
  text: string;
  contextToken: string;
  clientId?: string;
};

export async function getIlinkQrCode(): Promise<IlinkQrCode> {
  const response = await fetch(`${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const payload = await readJsonResponse(response, "QR code request failed");
  const qrcodeId = stringField(payload, "qrcode");
  const rawImage = stringField(payload, "qrcode_img_content");

  if (!qrcodeId) throw new Error("iLink QR response is missing qrcode");
  if (!rawImage) throw new Error("iLink QR response is missing qrcode_img_content");

  return {
    qrcodeId,
    qrcodeImage: await normalizeQrImage(rawImage),
    expiresInSeconds: 300,
  };
}

export async function checkIlinkQrCode(qrcodeId: string): Promise<IlinkQrStatus> {
  const url = new URL(`${ILINK_BASE_URL}/ilink/bot/get_qrcode_status`);
  url.searchParams.set("qrcode", qrcodeId);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const payload = await readJsonResponse(response, "QR status request failed");
  const botToken = stringField(payload, "bot_token");
  const baseUrl = stringField(payload, "baseurl");
  if (botToken && baseUrl) return { status: "confirmed", botToken, baseUrl };

  const rawStatus = String((payload as Record<string, unknown>).status ?? "waiting").toLowerCase();
  if (rawStatus.includes("expire") || rawStatus === "4") return { status: "expired" };
  if (rawStatus.includes("scan") || rawStatus.includes("confirm") || rawStatus === "1" || rawStatus === "2") {
    return { status: "scanned" };
  }
  return { status: "pending" };
}

export async function pollIlinkUpdates(
  credentials: IlinkCredentials,
  cursor: string
): Promise<IlinkPollResult> {
  const response = await fetch(`${trimSlash(credentials.baseUrl)}/ilink/bot/getupdates`, {
    method: "POST",
    headers: buildIlinkHeaders(credentials),
    body: JSON.stringify({
      get_updates_buf: cursor,
      base_info: { channel_version: ILINK_CHANNEL_VERSION },
    }),
  });
  const payload = await readJsonResponse(response, "iLink getupdates failed");
  assertIlinkResponseOk(payload, "iLink getupdates failed");

  return {
    cursor: stringField(payload, "get_updates_buf") || cursor,
    messages: extractIlinkInboundMessages(payload),
  };
}

export async function sendIlinkMessage(
  credentials: IlinkCredentials,
  toUserId: string,
  contextToken: string,
  text: string
): Promise<IlinkSendResult> {
  const response = await fetch(`${trimSlash(credentials.baseUrl)}/ilink/bot/sendmessage`, {
    method: "POST",
    headers: buildIlinkHeaders(credentials),
    body: JSON.stringify(buildIlinkSendBody({ toUserId, contextToken, text })),
  });

  let payload: unknown = {};
  try {
    payload = await readJsonResponse(response, "iLink sendmessage failed");
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }

  const ret = numberField(payload, "ret");
  if (ret === -2) return { status: "context_expired" };
  if (ret !== null && ret !== 0) {
    return { status: "failed", reason: `ret=${ret}: ${stringField(payload, "errmsg") || "unknown error"}` };
  }
  const errcode = numberField(payload, "errcode");
  if (errcode !== null && errcode !== 0) {
    return { status: "failed", reason: `errcode=${errcode}: ${stringField(payload, "errmsg") || "unknown error"}` };
  }
  return { status: "sent" };
}

export function buildIlinkSendBody(input: IlinkSendBodyInput): Record<string, unknown> {
  return {
    msg: {
      from_user_id: "",
      to_user_id: input.toUserId,
      client_id: input.clientId ?? `todo-${randomUUID()}`,
      message_type: 2,
      message_state: 2,
      context_token: input.contextToken,
      item_list: [{ type: 1, text_item: { text: input.text } }],
    },
    base_info: { channel_version: ILINK_CHANNEL_VERSION },
  };
}

export function extractIlinkInboundMessages(payload: unknown): IlinkInboundMessage[] {
  const msgs = arrayField(payload, "msgs");
  const messages: IlinkInboundMessage[] = [];

  for (const msg of msgs) {
    if (numberField(msg, "message_type") !== 1) continue;

    const fromUserId = stringField(msg, "from_user_id");
    const contextToken = stringField(msg, "context_token");
    const text = extractMessageText(msg);
    if (!fromUserId || !contextToken || !text) continue;

    messages.push({ fromUserId, text, contextToken });
  }

  return messages;
}

export function createIlinkWechatUin(): string {
  return Buffer.from(String(randomInt(100_000_000, 999_999_999))).toString("base64");
}

function buildIlinkHeaders(credentials: IlinkCredentials): Record<string, string> {
  return {
    "content-type": "application/json",
    authorizationtype: "ilink_bot_token",
    authorization: `Bearer ${credentials.botToken}`,
    "x-wechat-uin": credentials.wechatUin,
  };
}

async function normalizeQrImage(rawImage: string): Promise<string> {
  if (rawImage.startsWith("data:image/")) return rawImage;
  if (rawImage.startsWith("http://") || rawImage.startsWith("https://")) {
    const fetched = await fetchImageAsDataUri(rawImage).catch(() => null);
    if (fetched) return fetched;
    return QRCode.toDataURL(rawImage, { margin: 2, width: 280 });
  }
  if (rawImage.startsWith("data:")) return rawImage;
  return `data:image/png;base64,${rawImage}`;
}

async function fetchImageAsDataUri(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
      referer: ILINK_BASE_URL,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) throw new Error(`QR image fetch failed: ${response.status}`);

  const contentType = response.headers.get("content-type") ?? "image/png";
  if (contentType.includes("text/html") || contentType.includes("text/plain")) {
    throw new Error("QR image URL returned text");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("QR image response is empty");
  return `data:${contentType.split(";")[0]};base64,${bytes.toString("base64")}`;
}

async function readJsonResponse(response: Response, message: string): Promise<unknown> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${message}: HTTP ${response.status} ${body.slice(0, 200)}`);
  }
  return response.json();
}

function assertIlinkResponseOk(payload: unknown, message: string): void {
  const errcode = numberField(payload, "errcode");
  if (errcode !== null && errcode !== 0) {
    throw new Error(`${message}: errcode=${errcode} ${stringField(payload, "errmsg")}`);
  }
  const ret = numberField(payload, "ret");
  if (ret === -14) throw new Error(`${message}: iLink session expired`);
}

function extractMessageText(msg: unknown): string {
  const items = arrayField(msg, "item_list");
  for (const item of items) {
    const type = numberField(item, "type");
    const text =
      type === 1
        ? stringField(objectField(item, "text_item"), "text")
        : type === 3
          ? stringField(objectField(item, "voice_item"), "text")
          : "";
    if (text.trim()) return text.trim();
  }
  return "";
}

function objectField(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object" && !Array.isArray(nested) ? (nested as Record<string, unknown>) : {};
}

function arrayField(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object") return [];
  const nested = (value as Record<string, unknown>)[key];
  return Array.isArray(nested) ? nested : [];
}

function stringField(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "string" ? nested.trim() : "";
}

function numberField(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object") return null;
  const nested = (value as Record<string, unknown>)[key];
  if (typeof nested === "number") return nested;
  if (typeof nested === "string" && nested.trim() && Number.isFinite(Number(nested))) return Number(nested);
  return null;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
