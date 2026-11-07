import { createHmac } from "node:crypto";
import { expect, test } from "vitest";
import { buildRequestBody, parseDestination, truncateBytes } from "../api/_notify/channels";
import { businessClock, runDeliveryBatch } from "../api/_notify/delivery";

const workspace = "11111111-1111-4111-8111-111111111111";
const secret = "test-webhook-secret";
const feishuUrl = "https://open.feishu.cn/open-apis/bot/v2/hook/test-hook";
const wecomUrl = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key";
const feishuEnv = { WORKSPACE_WEBHOOKS: JSON.stringify({ [workspace]: { url: feishuUrl, secret } }) };
const wecomEnv = { WORKSPACE_WEBHOOKS: JSON.stringify({ [workspace]: { url: wecomUrl } }) };
const NOW = new Date("2026-11-07T01:30:00Z");

function database() {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "wt_enqueue_digest") return { error: null, data: { enqueued: 1 } };
      if (name === "wt_claim_notifications") {
        return {
          error: null,
          data: [
            {
              id: "notification-id",
              workspace_id: workspace,
              payload: { message: "【待接收】提交报告" },
              mentions: ["13800000001"],
              claim_token: "claim-123",
              attempts: 1,
            },
          ],
        };
      }
      return { error: null, data: { status: "sent" } };
    },
  };
}
const okFetch = (reply: unknown) => (async () => new Response(JSON.stringify(reply))) as unknown as typeof fetch;

test("企业微信：@ 手机号，errcode 为 0 才算成功", async () => {
  const db = database();
  const requests: { url: string; options: RequestInit }[] = [];
  const fetchImpl = (async (input: unknown, options: RequestInit) => {
    requests.push({ url: String(input), options });
    return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }));
  }) as typeof fetch;
  expect(await runDeliveryBatch(db, wecomEnv, { fetchImpl, now: NOW })).toEqual({ enqueued: 0, claimed: 1, sent: 1, failed: 0 });
  expect(requests[0].url).toBe(wecomUrl);
  expect(requests[0].options.redirect).toBe("error");
  expect(JSON.parse(String(requests[0].options.body))).toEqual({
    msgtype: "text",
    text: { content: "【待接收】提交报告", mentioned_mobile_list: ["13800000001"] },
  });
  expect(db.calls.map((c) => c.name)).toEqual(["wt_claim_notifications", "wt_finish_notification"]);
  expect(db.calls[0].args).toEqual({ p_limit: 15, p_today: "2026-11-07" });
  expect(db.calls[1].args).toEqual({ p_id: "notification-id", p_claim_token: "claim-123", p_error: null });
});

test("飞书：带签名，code 为 0 才算成功", async () => {
  const requests: RequestInit[] = [];
  const fetchImpl = (async (_: unknown, options: RequestInit) => {
    requests.push(options);
    return new Response(JSON.stringify({ code: 0 }));
  }) as typeof fetch;
  expect(await runDeliveryBatch(database(), feishuEnv, { fetchImpl, now: NOW })).toMatchObject({ sent: 1 });
  const body = JSON.parse(String(requests[0].body));
  expect(body).toMatchObject({ msg_type: "text", content: { text: "【待接收】提交报告" } });
  expect(body.sign).toBe(createHmac("sha256", `${body.timestamp}\n${secret}`).update("").digest("base64"));
});

test("HTTP 错误、错误码、坏响应和网络错误都记为可重试，错误里不含地址和密钥", async () => {
  for (const [env, fetchImpl] of [
    [wecomEnv, (async () => new Response("sensitive", { status: 500 })) as unknown as typeof fetch],
    [wecomEnv, okFetch({ errcode: 93000, errmsg: wecomUrl })],
    [wecomEnv, okFetch({ code: 0 })], // 飞书的成功码不能让企业微信算成功
    [feishuEnv, okFetch({ errcode: 0 })],
    [feishuEnv, okFetch({ code: 19021, msg: secret })],
    [wecomEnv, (async () => new Response("not json")) as unknown as typeof fetch],
    [
      wecomEnv,
      (async () => {
        throw new Error(`${wecomUrl} ${secret}`);
      }) as unknown as typeof fetch,
    ],
  ] as const) {
    const db = database();
    expect(await runDeliveryBatch(db, env, { fetchImpl, now: NOW })).toMatchObject({ sent: 0, failed: 1 });
    expect(db.calls.at(-1)?.args?.p_error).toBe("Delivery failed");
    expect(JSON.stringify(db.calls)).not.toContain(secret);
    expect(JSON.stringify(db.calls)).not.toContain("test-key");
  }
});

test("配置缺失或地址不可信时直接失败，不碰队列也不发请求", async () => {
  const forbidden = [
    "http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=a",
    "https://qyapi.weixin.qq.com.attacker.test/cgi-bin/webhook/send?key=a",
    "https://qyapi.weixin.qq.com@attacker.test/cgi-bin/webhook/send?key=a",
    "https://qyapi.weixin.qq.com/cgi-bin/webhook/send",
    "https://qyapi.weixin.qq.com/cgi-bin/other?key=a",
    "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=a&x=1",
    "http://open.feishu.cn/open-apis/bot/v2/hook/a",
    "https://open.feishu.cn.attacker.test/open-apis/bot/v2/hook/a",
    "https://open.feishu.cn:444/open-apis/bot/v2/hook/a",
    "https://open.feishu.cn/open-apis/bot/v2/hook/a?token=secret",
    "https://open.feishu.cn/open-apis/bot/v2/hook/a/extra",
    "https://example.com/hook",
  ];
  const configs = [
    undefined,
    "not-json",
    "{}",
    JSON.stringify({ "not-a-uuid": { url: wecomUrl } }),
    ...forbidden.map((url) => JSON.stringify({ [workspace]: { url, secret } })),
  ];
  for (const config of configs) {
    const db = database();
    const fetchImpl = (async () => {
      throw new Error("must not fetch");
    }) as unknown as typeof fetch;
    await expect(runDeliveryBatch(db, { WORKSPACE_WEBHOOKS: config }, { fetchImpl, now: NOW })).rejects.toThrow(
      "Invalid webhook configuration",
    );
    expect(db.calls).toEqual([]);
  }
  expect(() => parseDestination({ url: feishuUrl })).toThrow(); // 飞书必须开启签名
});

test("回写失败不能算发送成功", async () => {
  const db = database();
  const boundary = {
    rpc: async (name: string, args?: Record<string, unknown>) =>
      name === "wt_finish_notification" ? { data: null, error: { message: wecomUrl } } : db.rpc(name, args),
  };
  await expect(runDeliveryBatch(boundary, wecomEnv, { fetchImpl: okFetch({ errcode: 0 }), now: NOW })).rejects.toThrow(
    "Notification receipt unavailable",
  );
});

test("企业微信消息按字节截断，不会切坏中文，也不会超过上限", () => {
  const long = "待办事项".repeat(1000);
  const body = JSON.parse(buildRequestBody({ kind: "wecom", url: wecomUrl }, { text: long, mentionMobiles: [], now: NOW }));
  expect(Buffer.byteLength(body.text.content)).toBeLessThanOrEqual(2048);
  expect(body.text.content.endsWith("…")).toBe(true);
  expect(body.text.content).not.toContain("�");
  expect(truncateBytes("短消息", 2000)).toBe("短消息");
});

test("业务日期按配置的时区计算，不用服务器时区", () => {
  expect(businessClock(new Date("2026-11-06T16:30:00Z"), {})).toEqual({ date: "2026-11-07", hour: 0 });
  expect(businessClock(new Date("2026-11-06T16:30:00Z"), { APP_TIMEZONE: "UTC" })).toEqual({ date: "2026-11-06", hour: 16 });
  expect(() => businessClock(NOW, { APP_TIMEZONE: "Mars/Base" })).toThrow("Invalid time zone configuration");
});
