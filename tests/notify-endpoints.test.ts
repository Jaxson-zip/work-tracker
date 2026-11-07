import { expect, test } from "vitest";
import { createDispatchHandler } from "../api/notify/dispatch";
import { createFlushHandler } from "../api/notify/flush";

const env = (secret: string) => ({
  CRON_SECRET: secret,
  WORKSPACE_WEBHOOKS: JSON.stringify({
    "11111111-1111-4111-8111-111111111111": { url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k" },
  }),
});
function fakeResponse() {
  const result = { status: 0, body: undefined as unknown };
  const response: any = {
    status(value: number) {
      result.status = value;
      return this;
    },
    setHeader() {
      return this;
    },
    json(value: unknown) {
      result.body = value;
      return this;
    },
  };
  return { result, response };
}

test("定时入口必须带正确的密钥才碰队列，GET 和 POST 都支持", async () => {
  // 北京时间 09:30，到了摘要时间
  const now = () => new Date("2026-11-07T01:30:00Z");
  for (const [method, secret, bearer, expected] of [
    ["GET", "cron-secret", "wrong", 401],
    ["GET", "", "anything", 503],
    ["GET", "cron-secret", "cron-secret", 200],
    ["POST", "cron-secret", "cron-secret", 200],
    ["DELETE", "cron-secret", "cron-secret", 405],
  ] as const) {
    const calls: string[] = [];
    const client = {
      rpc: async (name: string) => {
        calls.push(name);
        return { data: name === "wt_claim_notifications" ? [] : { enqueued: 0 }, error: null };
      },
    };
    const { result, response } = fakeResponse();
    await createDispatchHandler({ env: env(secret), getClient: () => client, now })(
      { method, headers: { authorization: `Bearer ${bearer}` } } as any,
      response,
    );
    expect(result.status).toBe(expected);
    expect(calls).toEqual(expected === 200 ? ["wt_enqueue_digest", "wt_claim_notifications"] : []);
    expect(JSON.stringify(result.body)).not.toContain("cron-secret");
  }
});

test("立即发送入口要求已登录，只发送队列，不生成摘要", async () => {
  const calls: string[] = [];
  const client = {
    auth: {
      getUser: async (token: string) =>
        token === "good-token" ? { data: { user: { id: "u" } }, error: null } : { data: { user: null }, error: { message: "bad" } },
    },
    rpc: async (name: string) => {
      calls.push(name);
      return { data: [], error: null };
    },
  };
  const handler = createFlushHandler({ env: env("x"), getClient: () => client });
  for (const [headers, expected] of [
    [{}, 401],
    [{ authorization: "Bearer bad-token" }, 401],
    [{ authorization: "Bearer good-token" }, 200],
  ] as const) {
    calls.length = 0;
    const { result, response } = fakeResponse();
    await handler({ method: "POST", headers } as any, response);
    expect(result.status).toBe(expected);
    expect(calls).toEqual(expected === 200 ? ["wt_claim_notifications"] : []);
  }
  const { result, response } = fakeResponse();
  await handler({ method: "GET", headers: {} } as any, response);
  expect(result.status).toBe(405);
});
