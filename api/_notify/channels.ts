import { createHmac } from "node:crypto";

export type Destination = { kind: "wecom" | "feishu"; url: string; secret?: string };
export type OutgoingMessage = { text: string; mentionMobiles: string[]; now: Date };

// 企业微信文本消息上限 2048 字节，超长会被整条拒绝。留一点余量给省略号。
const WECOM_MAX_BYTES = 2000;
const FEISHU_HOSTS = ["open.feishu.cn", "open.larksuite.com"];

export function parseDestination(entry: unknown): Destination {
  const { url: raw, secret } = (entry ?? {}) as { url?: unknown; secret?: unknown };
  if (typeof raw !== "string") throw new Error("Invalid destination");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) throw new Error("Invalid destination");
  if (url.hostname === "qyapi.weixin.qq.com") {
    const keys = [...url.searchParams.keys()];
    if (url.pathname !== "/cgi-bin/webhook/send" || keys.length !== 1 || !url.searchParams.get("key"))
      throw new Error("Invalid destination");
    return { kind: "wecom", url: url.href };
  }
  if (FEISHU_HOSTS.includes(url.hostname)) {
    if (url.search || !/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error("Invalid destination");
    if (typeof secret !== "string" || !secret.trim()) throw new Error("Invalid destination");
    return { kind: "feishu", url: url.href, secret };
  }
  throw new Error("Invalid destination");
}

export function truncateBytes(text: string, maxBytes: number): string {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= maxBytes) return text;
  // 按字节截断可能切开多字节字符，解码后去掉产生的替换符。
  return `${encoded.subarray(0, maxBytes).toString("utf8").replace(/�+$/, "")}…`;
}

export function buildRequestBody(destination: Destination, message: OutgoingMessage): string {
  if (destination.kind === "wecom") {
    return JSON.stringify({
      msgtype: "text",
      text: { content: truncateBytes(message.text, WECOM_MAX_BYTES), mentioned_mobile_list: message.mentionMobiles },
    });
  }
  const timestamp = String(Math.floor(message.now.getTime() / 1000));
  const sign = createHmac("sha256", `${timestamp}\n${destination.secret}`).update("").digest("base64");
  return JSON.stringify({ timestamp, sign, msg_type: "text", content: { text: message.text } });
}

// 两家都用 HTTP 200 返回业务错误，必须检查响应体里的错误码。
export function isDelivered(destination: Destination, body: unknown): boolean {
  const parsed = (body ?? {}) as { errcode?: unknown; code?: unknown };
  return destination.kind === "wecom" ? parsed.errcode === 0 : parsed.code === 0;
}
