import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runDeliveryBatch } from "../api/_notify/delivery";
import type { RpcClient } from "../api/_notify/types";
import { createTestDatabase } from "./helpers/database";

const users = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const [OWNER, ZHANG, LI] = [0, 1, 2];
const TODAY = "2026-11-07";
// 北京时间 09:30
const NOW = new Date("2026-11-07T01:30:00Z");
let db: PGlite;

async function command(index: number, action: string, payload = {}): Promise<any> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[index]]);
  await db.exec("set role authenticated");
  const result = await db.query("select public.wt_command($1, $2::jsonb) as result", [action, JSON.stringify(payload)]);
  return (result.rows[0] as any).result;
}
async function service(sql: string, params: unknown[] = []): Promise<any[]> {
  await db.exec("reset role");
  await db.exec("set role service_role");
  return (await db.query(sql, params)).rows as any[];
}
// 和 Supabase rpc 一样按参数名调用，但走真实 SQL。
const rpcClient: RpcClient = {
  async rpc(name, args = {}) {
    const keys = Object.keys(args);
    const placeholders = keys.map((key, i) => `${key} => $${i + 1}`).join(",");
    try {
      const rows = await service(
        `select * from public.${name}(${placeholders})`,
        keys.map((k) => args[k]),
      );
      if (name === "wt_claim_notifications") return { data: rows, error: null };
      return { data: Object.values(rows[0] ?? {})[0], error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};
async function team() {
  const w = (await command(OWNER, "create_workspace", { name: "Team" })).id as string;
  for (const index of [ZHANG, LI]) {
    const invite = await command(OWNER, "invite", { workspaceId: w, role: "member" });
    await command(index, "join_workspace", { code: invite.code });
  }
  return w;
}
function wecomEnv(w: string) {
  return {
    WORKSPACE_WEBHOOKS: JSON.stringify({ [w]: { url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key" } }),
    APP_BASE_URL: "https://tracker.example",
  };
}
function recordingFetch(reply: unknown = { errcode: 0, errmsg: "ok" }) {
  const bodies: any[] = [];
  const fetchImpl = (async (_url: unknown, options: RequestInit) => {
    bodies.push(JSON.parse(String(options.body)));
    return new Response(JSON.stringify(reply));
  }) as typeof fetch;
  return { bodies, fetchImpl };
}
async function clearQueue() {
  await db.exec("reset role");
  await db.exec("update public.wt_outbox set status='sent'; update public.wt_tasks set status='done';");
}

beforeAll(async () => {
  db = await createTestDatabase(users);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("通知队列", () => {
  test("转交消息带具体内容、@ 接收方手机号和系统链接", async () => {
    await clearQueue();
    const w = await team();
    await command(LI, "update_profile", { displayName: "李四", mobile: "13800000002" });
    await command(ZHANG, "update_profile", { displayName: "张三" });
    const task = await command(ZHANG, "create_task", { workspaceId: w, title: "续签合同", ownerId: users[ZHANG], dueDate: "2026-11-10" });
    await command(ZHANG, "transfer_task", { workspaceId: w, taskId: task.id, expectedVersion: 1, ownerId: users[LI], reason: "我要休假" });
    const { bodies, fetchImpl } = recordingFetch();
    expect(await runDeliveryBatch(rpcClient, wecomEnv(w), { fetchImpl, now: NOW })).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(bodies[0].msgtype).toBe("text");
    expect(bodies[0].text.content).toContain("【待接收】张三 把「续签合同」转给 李四");
    expect(bodies[0].text.content).toContain("说明：我要休假");
    expect(bodies[0].text.content).toContain("截止：2026-11-10");
    expect(bodies[0].text.content).toContain("https://tracker.example");
    expect(bodies[0].text.mentioned_mobile_list).toEqual(["13800000002"]);
    // 已发送的不会重复发
    expect(await runDeliveryBatch(rpcClient, wecomEnv(w), { fetchImpl, now: NOW })).toMatchObject({ claimed: 0 });
  });

  test("企业微信返回错误码时不算成功，稍后重试，错误里不含密钥", async () => {
    await clearQueue();
    const w = await team();
    await command(ZHANG, "create_task", { workspaceId: w, title: "会失败", ownerId: users[LI] });
    const failing = recordingFetch({ errcode: 93000, errmsg: "invalid webhook url test-key" });
    expect(await runDeliveryBatch(rpcClient, wecomEnv(w), { fetchImpl: failing.fetchImpl, now: NOW })).toMatchObject({
      sent: 0,
      failed: 1,
    });
    const outbox = (await command(OWNER, "snapshot", { workspaceId: w })).outbox;
    expect(outbox[0]).toMatchObject({ status: "pending", last_error: "Delivery failed" });
    expect(JSON.stringify(outbox)).not.toContain("test-key");
    await db.exec("reset role");
    await db.query("update public.wt_outbox set available_at=now()-interval '1 second' where id=$1", [outbox[0].id]);
    const healthy = recordingFetch();
    expect(await runDeliveryBatch(rpcClient, wecomEnv(w), { fetchImpl: healthy.fetchImpl, now: NOW })).toMatchObject({
      sent: 1,
      failed: 0,
    });
  });

  test("没给这个团队配 Webhook 时不会发到别的群，并显示原因", async () => {
    await clearQueue();
    const w = await team();
    const other = await team();
    await command(ZHANG, "create_task", { workspaceId: w, title: "不能外泄", ownerId: users[LI] });
    const { bodies, fetchImpl } = recordingFetch();
    const result = await runDeliveryBatch(rpcClient, wecomEnv(other), { fetchImpl, now: NOW });
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(bodies).toEqual([]);
    expect((await command(OWNER, "snapshot", { workspaceId: w })).outbox[0].last_error).toBe("No webhook configured for this team");
  });

  test("每日摘要：每团队一天一条，按类别列出，@ 相关的人", async () => {
    await clearQueue();
    const w = await team();
    await command(ZHANG, "update_profile", { displayName: "张三", mobile: "13800000001" });
    await command(LI, "update_profile", { displayName: "李四", mobile: "13800000002" });
    await command(ZHANG, "create_task", { workspaceId: w, title: "已逾期的事", ownerId: users[ZHANG], dueDate: "2026-11-01" });
    await command(ZHANG, "create_task", { workspaceId: w, title: "今天到期的事", ownerId: users[ZHANG], dueDate: TODAY });
    await command(ZHANG, "create_task", { workspaceId: w, title: "以后的事", ownerId: users[ZHANG], dueDate: "2030-01-01" });
    await db.exec("reset role");
    await db.exec("update public.wt_outbox set status='sent'");
    await command(ZHANG, "create_task", { workspaceId: w, title: "等李四接收", ownerId: users[LI] });
    const { bodies, fetchImpl } = recordingFetch();
    const first = await runDeliveryBatch(rpcClient, wecomEnv(w), { fetchImpl, now: NOW, digest: true });
    expect(first).toMatchObject({ enqueued: 1, sent: 2, failed: 0 });
    const digest = bodies.find((b) => b.text.content.startsWith("【每日待办"));
    expect(digest.text.content).toContain("【每日待办 11-07】");
    expect(digest.text.content).toContain("待接收（1）\n· 李四：等李四接收");
    expect(digest.text.content).toContain("已逾期（1）\n· 张三：已逾期的事");
    expect(digest.text.content).toContain("今天到期（1）\n· 张三：今天到期的事");
    expect(digest.text.content).not.toContain("以后的事");
    expect([...digest.text.mentioned_mobile_list].sort()).toEqual(["13800000001", "13800000002"]);
    expect(await runDeliveryBatch(rpcClient, wecomEnv(w), { fetchImpl, now: NOW, digest: true })).toMatchObject({
      enqueued: 0,
      claimed: 0,
    });
  });

  test("早于摘要时间不生成；普通发送不生成；过期的摘要不再补发", async () => {
    await clearQueue();
    const w = await team();
    await command(ZHANG, "create_task", { workspaceId: w, title: "逾期", ownerId: users[ZHANG], dueDate: "2026-11-01" });
    const { fetchImpl } = recordingFetch();
    const early = new Date("2026-11-07T00:30:00Z"); // 北京时间 08:30
    expect(await runDeliveryBatch(rpcClient, wecomEnv(w), { fetchImpl, now: early, digest: true })).toMatchObject({
      enqueued: 0,
      claimed: 0,
    });
    expect(await runDeliveryBatch(rpcClient, wecomEnv(w), { fetchImpl, now: NOW })).toMatchObject({ enqueued: 0, claimed: 0 });
    await service("select public.wt_enqueue_digest($1)", ["2026-11-06"]);
    expect(await runDeliveryBatch(rpcClient, wecomEnv(w), { fetchImpl, now: NOW })).toMatchObject({ claimed: 0 });
    const outbox = (await command(OWNER, "snapshot", { workspaceId: w })).outbox;
    expect(outbox.every((x: any) => x.status === "cancelled")).toBe(true);
  });

  test("认领有租约，令牌不对不能回写，超过重试上限后标记失败，管理员可重新排队", async () => {
    await clearQueue();
    const w = await team();
    await command(ZHANG, "create_task", { workspaceId: w, title: "租约", ownerId: users[LI] });
    const claim = () => service("select * from public.wt_claim_notifications(20,$1)", [TODAY]);
    const [row] = await claim();
    expect(row.attempts).toBe(1);
    expect(await claim()).toEqual([]);
    await expect(
      service("select public.wt_finish_notification($1,$2,null)", [row.id, "99999999-9999-4999-8999-999999999999"]),
    ).rejects.toThrow(/claim/i);
    await service("select public.wt_finish_notification($1,$2,$3)", [row.id, row.claim_token, "x".repeat(5000)]);
    for (let attempt = 2; attempt <= 5; attempt++) {
      await db.exec("reset role");
      await db.query("update public.wt_outbox set available_at=now()-interval '1 second' where id=$1", [row.id]);
      const [next] = await claim();
      expect(next.attempts).toBe(attempt);
      await service("select public.wt_finish_notification($1,$2,$3)", [next.id, next.claim_token, "boom"]);
    }
    const failed = (await command(OWNER, "snapshot", { workspaceId: w })).outbox[0];
    expect(failed.status).toBe("failed");
    await expect(command(LI, "retry_notification", { workspaceId: w, notificationId: failed.id })).rejects.toThrow(/Forbidden/);
    await command(OWNER, "retry_notification", { workspaceId: w, notificationId: failed.id });
    expect(await claim()).toHaveLength(1);
  });

  test("普通用户不能调用队列函数", async () => {
    await command(ZHANG, "snapshot");
    await expect(db.query("select public.wt_enqueue_digest('2026-11-07')")).rejects.toThrow(/permission denied/i);
    await expect(db.query("select * from public.wt_claim_notifications(1,'2026-11-07')")).rejects.toThrow(/permission denied/i);
  });
});
