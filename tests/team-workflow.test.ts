import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "./helpers/database";

const users = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];
const [OWNER, ZHANG, LI, OUTSIDER] = [0, 1, 2, 3];
let db: PGlite;

async function asUser(index: number, sql: string, params: unknown[] = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[index]]);
  await db.exec("set role authenticated");
  return db.query(sql, params);
}
async function command(index: number, action: string, payload = {}): Promise<any> {
  const result = await asUser(index, "select public.wt_command($1, $2::jsonb) as result", [action, JSON.stringify(payload)]);
  return (result.rows[0] as any).result;
}
async function team() {
  const w = (await command(OWNER, "create_workspace", { name: "Team", department: "总部" })).id as string;
  for (const [index, department] of [
    [ZHANG, "运营部"],
    [LI, "技术部"],
  ] as const) {
    const invite = await command(OWNER, "invite", { workspaceId: w, role: "member" });
    await command(index, "join_workspace", { code: invite.code, department });
  }
  return w;
}
const snapshot = (index: number, w: string) => command(index, "snapshot", { workspaceId: w });
const findTask = async (w: string, id: string) => (await snapshot(OWNER, w)).tasks.find((t: any) => t.id === id);
const messages = async (w: string): Promise<string[]> => (await snapshot(OWNER, w)).outbox.map((x: any) => x.message);

beforeAll(async () => {
  db = await createTestDatabase(users);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("转交：接收方确认后才算他的", () => {
  test("接收前负责人不变，只有接收方能接收，接收后才换人并开始", async () => {
    const w = await team();
    const task = await command(ZHANG, "create_task", { workspaceId: w, title: "续签合同", ownerId: users[ZHANG] });
    const pending = await command(ZHANG, "transfer_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: 1,
      ownerId: users[LI],
      reason: "我要休假",
    });
    expect(pending).toMatchObject({
      owner_id: users[ZHANG],
      pending_owner_id: users[LI],
      handoff_by: users[ZHANG],
      handoff_note: "我要休假",
    });
    await expect(command(ZHANG, "accept_transfer", { workspaceId: w, taskId: task.id })).rejects.toThrow(/receiver/);
    await expect(command(OWNER, "accept_transfer", { workspaceId: w, taskId: task.id })).rejects.toThrow(/receiver/);
    const accepted = await command(LI, "accept_transfer", { workspaceId: w, taskId: task.id });
    expect(accepted).toMatchObject({ owner_id: users[LI], pending_owner_id: null, handoff_by: null, status: "in_progress" });
    const notices = await messages(w);
    expect(notices.some((m) => m.startsWith("【待接收】") && m.includes("续签合同") && m.includes("我要休假"))).toBe(true);
    expect(notices.some((m) => m.startsWith("【已接收】"))).toBe(true);
  });

  test("等待接收期间不能改状态，也不能再转给第三人", async () => {
    const w = await team();
    const task = await command(ZHANG, "create_task", { workspaceId: w, title: "排期", ownerId: users[ZHANG] });
    const v = (
      await command(ZHANG, "transfer_task", { workspaceId: w, taskId: task.id, expectedVersion: 1, ownerId: users[LI], reason: "x" })
    ).version;
    await expect(
      command(ZHANG, "transition_task", { workspaceId: w, taskId: task.id, expectedVersion: v, status: "done" }),
    ).rejects.toThrow(/Handoff pending/);
    await expect(
      command(ZHANG, "transfer_task", { workspaceId: w, taskId: task.id, expectedVersion: v, ownerId: users[OWNER], reason: "y" }),
    ).rejects.toThrow(/Handoff pending/);
  });

  test("退回必须写原因，事项回到原负责人并提醒发起人，处理后提醒消失", async () => {
    const w = await team();
    const task = await command(ZHANG, "create_task", { workspaceId: w, title: "对接接口", ownerId: users[ZHANG] });
    await command(ZHANG, "transfer_task", { workspaceId: w, taskId: task.id, expectedVersion: 1, ownerId: users[LI], reason: "x" });
    await expect(command(LI, "reject_transfer", { workspaceId: w, taskId: task.id, reason: "  " })).rejects.toThrow(/Reason required/);
    await expect(command(ZHANG, "reject_transfer", { workspaceId: w, taskId: task.id, reason: "代拒" })).rejects.toThrow(/receiver/);
    const rejected = await command(LI, "reject_transfer", { workspaceId: w, taskId: task.id, reason: "这周排满了" });
    expect(rejected).toMatchObject({
      owner_id: users[ZHANG],
      pending_owner_id: null,
      returned_to: users[ZHANG],
      returned_by: users[LI],
      returned_note: "这周排满了",
    });
    expect((await messages(w)).some((m) => m.startsWith("【被退回】") && m.includes("这周排满了"))).toBe(true);
    await expect(command(LI, "ack_return", { workspaceId: w, taskId: task.id })).rejects.toThrow(/Forbidden/);
    expect(await command(ZHANG, "ack_return", { workspaceId: w, taskId: task.id })).toMatchObject({ returned_to: null, returned_note: "" });
  });

  test("重新转出会清除退回提醒；发起人可以撤回", async () => {
    const w = await team();
    const task = await command(ZHANG, "create_task", { workspaceId: w, title: "写周报", ownerId: users[ZHANG] });
    await command(ZHANG, "transfer_task", { workspaceId: w, taskId: task.id, expectedVersion: 1, ownerId: users[LI], reason: "x" });
    const rejected = await command(LI, "reject_transfer", { workspaceId: w, taskId: task.id, reason: "不是我的" });
    const again = await command(ZHANG, "transfer_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: rejected.version,
      ownerId: users[OWNER],
      reason: "请你来",
    });
    expect(again).toMatchObject({ pending_owner_id: users[OWNER], returned_to: null, returned_note: "" });
    await expect(command(LI, "withdraw_transfer", { workspaceId: w, taskId: task.id })).rejects.toThrow(/Forbidden/);
    expect(await command(ZHANG, "withdraw_transfer", { workspaceId: w, taskId: task.id })).toMatchObject({
      owner_id: users[ZHANG],
      pending_owner_id: null,
    });
    expect((await messages(w)).some((m) => m.startsWith("【已撤回】"))).toBe(true);
  });

  test("指派给别人也要对方接收；记录转待办同样如此", async () => {
    const w = await team();
    const task = await command(OWNER, "create_task", { workspaceId: w, title: "跨部门任务", ownerId: users[ZHANG], dueDate: "2030-01-02" });
    expect(task).toMatchObject({ owner_id: users[OWNER], pending_owner_id: users[ZHANG], version: 1 });
    expect((await messages(w)).some((m) => m.includes("跨部门任务") && m.includes("2030-01-02"))).toBe(true);
    const record = await command(OWNER, "create_record", { workspaceId: w, title: "会议结论", occurredOn: "2026-11-06" });
    const fromRecord = await command(OWNER, "record_to_task", { workspaceId: w, recordId: record.id, ownerId: users[LI] });
    expect(fromRecord).toMatchObject({ source_record_id: record.id, pending_owner_id: users[LI] });
  });

  test("离职交接：一次转出所有未完成事项，接收方可以全部接收", async () => {
    const w = await team();
    const first = await command(ZHANG, "create_task", { workspaceId: w, title: "事项一", ownerId: users[ZHANG] });
    await command(ZHANG, "create_task", { workspaceId: w, title: "事项二", ownerId: users[ZHANG] });
    const closed = await command(ZHANG, "create_task", { workspaceId: w, title: "已完成", ownerId: users[ZHANG] });
    await command(ZHANG, "transition_task", { workspaceId: w, taskId: closed.id, expectedVersion: 1, status: "done" });
    await expect(
      command(LI, "transfer_all", { workspaceId: w, fromUserId: users[ZHANG], toUserId: users[LI], reason: "代别人转" }),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      command(OWNER, "transfer_all", { workspaceId: w, fromUserId: users[LI], toUserId: users[ZHANG], reason: "没东西" }),
    ).rejects.toThrow(/No open tasks/);
    expect(
      await command(OWNER, "transfer_all", { workspaceId: w, fromUserId: users[ZHANG], toUserId: users[LI], reason: "张三离职" }),
    ).toEqual({ count: 2 });
    expect((await findTask(w, first.id)).owner_id).toBe(users[ZHANG]);
    expect((await messages(w)).some((m) => m.includes("2 件事项") && m.includes("张三离职") && m.includes("事项一"))).toBe(true);
    expect(await command(LI, "accept_all", { workspaceId: w })).toEqual({ count: 2 });
    expect(await findTask(w, first.id)).toMatchObject({ owner_id: users[LI], status: "in_progress", pending_owner_id: null });
    expect((await findTask(w, closed.id)).owner_id).toBe(users[ZHANG]);
  });
});

describe("状态流转", () => {
  test("自己记的事可以直接完成；别人交来的事要发起人验收", async () => {
    const w = await team();
    const own = await command(ZHANG, "create_task", { workspaceId: w, title: "自己的事", ownerId: users[ZHANG] });
    expect((await command(ZHANG, "transition_task", { workspaceId: w, taskId: own.id, expectedVersion: 1, status: "done" })).status).toBe(
      "done",
    );

    const task = await command(ZHANG, "create_task", { workspaceId: w, title: "交给李四", ownerId: users[LI] });
    let current = await command(LI, "accept_transfer", { workspaceId: w, taskId: task.id });
    const go = (actor: number, status: string, reason = "") =>
      command(actor, "transition_task", { workspaceId: w, taskId: task.id, expectedVersion: current.version, status, reason });
    await expect(go(LI, "done")).rejects.toThrow(/Forbidden/);
    await expect(go(ZHANG, "review")).rejects.toThrow(/Forbidden/);
    current = await go(LI, "review");
    await expect(go(LI, "done")).rejects.toThrow(/Forbidden/);
    await expect(go(ZHANG, "in_progress")).rejects.toThrow(/Reason required/);
    current = await go(ZHANG, "in_progress", "缺数据");
    await expect(go(LI, "blocked", "   ")).rejects.toThrow(/Reason required/);
    current = await go(LI, "blocked", "等财务");
    current = await go(LI, "in_progress");
    current = await go(LI, "review");
    current = await go(ZHANG, "done");
    expect(current.status).toBe("done");
    const notices = await messages(w);
    for (const tag of ["【待验收】", "【验收退回】", "【受阻】", "【已完成】"]) expect(notices.some((m) => m.startsWith(tag))).toBe(true);
    await expect(asUser(LI, "update public.wt_tasks set status='done' where id=$1", [task.id])).rejects.toThrow(/permission denied/i);
  });

  test("可以取消和恢复，都要写原因；无关成员不能取消", async () => {
    const w = await team();
    const task = await command(ZHANG, "create_task", { workspaceId: w, title: "建错了", ownerId: users[ZHANG] });
    await expect(
      command(LI, "transition_task", { workspaceId: w, taskId: task.id, expectedVersion: 1, status: "cancelled", reason: "x" }),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      command(ZHANG, "transition_task", { workspaceId: w, taskId: task.id, expectedVersion: 1, status: "cancelled" }),
    ).rejects.toThrow(/Reason required/);
    const cancelled = await command(ZHANG, "transition_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: 1,
      status: "cancelled",
      reason: "重复",
    });
    expect(cancelled.status).toBe("cancelled");
    await expect(
      command(ZHANG, "transfer_task", {
        workspaceId: w,
        taskId: task.id,
        expectedVersion: cancelled.version,
        ownerId: users[LI],
        reason: "x",
      }),
    ).rejects.toThrow(/transition/i);
    expect(
      (
        await command(ZHANG, "transition_task", {
          workspaceId: w,
          taskId: task.id,
          expectedVersion: cancelled.version,
          status: "in_progress",
          reason: "搞错了",
        })
      ).status,
    ).toBe("in_progress");
  });

  test("版本号拒绝覆盖别人刚做的修改", async () => {
    const w = await team();
    const task = await command(ZHANG, "create_task", { workspaceId: w, title: "并发", ownerId: users[ZHANG] });
    await command(ZHANG, "update_task", { workspaceId: w, taskId: task.id, expectedVersion: 1, title: "新标题" });
    await expect(
      command(OWNER, "update_task", { workspaceId: w, taskId: task.id, expectedVersion: 1, title: "旧内容覆盖" }),
    ).rejects.toThrow(/Version conflict/);
  });

  test("成员离开后要先换负责人才能重新打开", async () => {
    const w = await team();
    const task = await command(OWNER, "create_task", { workspaceId: w, title: "已结束", ownerId: users[ZHANG] });
    let current = await command(ZHANG, "accept_transfer", { workspaceId: w, taskId: task.id });
    current = await command(ZHANG, "transition_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: current.version,
      status: "review",
    });
    current = await command(OWNER, "transition_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: current.version,
      status: "done",
    });
    await command(OWNER, "update_member", { workspaceId: w, userId: users[ZHANG], role: null });
    await expect(
      command(OWNER, "transition_task", {
        workspaceId: w,
        taskId: task.id,
        expectedVersion: current.version,
        status: "in_progress",
        reason: "返工",
      }),
    ).rejects.toThrow(/Reassign/);
    await command(OWNER, "transfer_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: current.version,
      ownerId: users[LI],
      reason: "接手",
    });
    expect(await command(LI, "accept_transfer", { workspaceId: w, taskId: task.id })).toMatchObject({
      owner_id: users[LI],
      status: "in_progress",
    });
  });

  test("通知入队失败时，事项和历史一起回滚", async () => {
    const w = await team();
    await db.exec("reset role");
    await db.exec(`create function public.test_reject_outbox() returns trigger language plpgsql as $$ begin raise exception 'Injected storage failure'; end $$;
      create trigger test_reject_outbox before insert on public.wt_outbox for each row execute function public.test_reject_outbox();`);
    try {
      await expect(command(ZHANG, "create_task", { workspaceId: w, title: "必须回滚", ownerId: users[LI] })).rejects.toThrow(
        /Injected storage failure/,
      );
    } finally {
      await db.exec("reset role");
      await db.exec("drop trigger test_reject_outbox on public.wt_outbox; drop function public.test_reject_outbox();");
    }
    const after = await snapshot(OWNER, w);
    expect(after.tasks).toEqual([]);
    expect(after.activities).toEqual([]);
  });
});

describe("成员资料", () => {
  test("部门可以自己改，改别人要管理员；同事读不到手机号", async () => {
    const w = await team();
    const members = (await snapshot(ZHANG, w)).members;
    expect(members.find((m: any) => m.user_id === users[LI]).department).toBe("技术部");
    await expect(command(ZHANG, "set_department", { workspaceId: w, userId: users[LI], department: "财务部" })).rejects.toThrow(
      /Forbidden/,
    );
    await command(ZHANG, "set_department", { workspaceId: w, userId: users[ZHANG], department: "市场部" });
    await command(OWNER, "set_department", { workspaceId: w, userId: users[LI], department: "财务部" });
    const updated = (await snapshot(OWNER, w)).members;
    expect(updated.find((m: any) => m.user_id === users[ZHANG]).department).toBe("市场部");
    expect(updated.find((m: any) => m.user_id === users[LI]).department).toBe("财务部");

    await command(ZHANG, "update_profile", { displayName: "张三", mobile: "13800000001" });
    await expect(command(ZHANG, "update_profile", { displayName: "张三", mobile: "12345" })).rejects.toThrow(/mobile/i);
    expect((await snapshot(ZHANG, w)).my_mobile).toBe("13800000001");
    expect((await snapshot(LI, w)).my_mobile).toBe("");
    expect(JSON.stringify(await snapshot(LI, w))).not.toContain("13800000001");
    await expect(asUser(LI, "select * from public.wt_contacts")).rejects.toThrow(/permission denied/i);
    await command(ZHANG, "update_profile", { displayName: "张三", mobile: "" });
    expect((await snapshot(ZHANG, w)).my_mobile).toBe("");
  });

  test("外部用户不能操作团队", async () => {
    const w = await team();
    await expect(command(OUTSIDER, "create_task", { workspaceId: w, title: "入侵", ownerId: users[OUTSIDER] })).rejects.toThrow(
      /Forbidden/,
    );
    await expect(command(OUTSIDER, "snapshot", { workspaceId: w })).rejects.toThrow(/Forbidden/);
  });
});
