import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "./helpers/database";

const users = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];
const [LEAD, FRONT, BACK, TEST] = [0, 1, 2, 3];
let db: PGlite;

async function command(index: number, action: string, payload = {}): Promise<any> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[index]]);
  await db.exec("set role authenticated");
  const result = await db.query("select public.wt_command($1, $2::jsonb) as result", [action, JSON.stringify(payload)]);
  return (result.rows[0] as any).result;
}
async function team() {
  const w = (await command(LEAD, "create_workspace", { name: "项目组" })).id as string;
  for (const index of [FRONT, BACK, TEST]) {
    const invite = await command(LEAD, "invite", { workspaceId: w });
    await command(index, "join_workspace", { code: invite.code });
  }
  return w;
}
async function pendingMessages(): Promise<string[]> {
  await db.exec("reset role");
  const rows = await db.query("select payload->>'message' as message from public.wt_outbox order by created_at");
  return rows.rows.map((row: any) => row.message);
}
const visibleTitles = async (index: number, w: string) =>
  (await command(index, "snapshot", { workspaceId: w })).tasks.map((task: any) => task.title).sort();
const activityOf = async (index: number, w: string, taskId: string) =>
  (await command(index, "snapshot", { workspaceId: w })).activities.filter((a: any) => a.task_id === taskId).map((a: any) => a.action);

beforeAll(async () => {
  db = await createTestDatabase(users);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("交接流程", () => {
  test("前端交给后端，后端接手后再交给测试，测试完成，经过按顺序留下", async () => {
    const w = await team();
    const task = await command(FRONT, "create_task", { workspaceId: w, title: "订单接口联调", ownerId: users[FRONT] });
    expect(task).toMatchObject({ owner_id: users[FRONT], status: "open", pending_owner_id: null });

    const sent = await command(FRONT, "handoff_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: task.version,
      toUserId: users[BACK],
      note: "页面做完了",
    });
    // 对方接手前，事情还算在原来的人手上
    expect(sent).toMatchObject({ owner_id: users[FRONT], pending_owner_id: users[BACK], handoff_note: "页面做完了" });

    const atBack = await command(BACK, "accept_task", { workspaceId: w, taskId: task.id });
    expect(atBack).toMatchObject({ owner_id: users[BACK], pending_owner_id: null, handoff_note: "" });

    await command(BACK, "handoff_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: atBack.version,
      toUserId: users[TEST],
      note: "接口好了",
    });
    const atTest = await command(TEST, "accept_task", { workspaceId: w, taskId: task.id });
    const done = await command(TEST, "complete_task", { workspaceId: w, taskId: task.id, expectedVersion: atTest.version });
    expect(done.status).toBe("done");

    expect(await activityOf(FRONT, w, task.id)).toEqual(["created", "handoff", "accepted", "handoff", "accepted", "done"]);
    const messages = await pendingMessages();
    expect(messages.some((m) => m.includes("把「订单接口联调」交给") && m.includes("交接说明：页面做完了"))).toBe(true);
    expect(messages.some((m) => m.includes("完成了「订单接口联调」"))).toBe(true);
  });

  test("写待办时直接交给别人，也要对方接手", async () => {
    const w = await team();
    const task = await command(FRONT, "create_task", { workspaceId: w, title: "直接交", ownerId: users[BACK], note: "麻烦看下" });
    expect(task).toMatchObject({
      owner_id: users[FRONT],
      pending_owner_id: users[BACK],
      handoff_by: users[FRONT],
      handoff_note: "麻烦看下",
    });
    expect(await activityOf(BACK, w, task.id)).toEqual(["created", "handoff"]);
  });

  test("退回要写原因，事情留在原来的人手上，可以再交给别人", async () => {
    const w = await team();
    const task = await command(FRONT, "create_task", { workspaceId: w, title: "退回", ownerId: users[BACK] });
    await expect(command(BACK, "reject_task", { workspaceId: w, taskId: task.id, note: " " })).rejects.toThrow(/Invalid note/);
    const back = await command(BACK, "reject_task", { workspaceId: w, taskId: task.id, note: "这周排满了" });
    expect(back).toMatchObject({ owner_id: users[FRONT], pending_owner_id: null });
    expect((await pendingMessages()).some((m) => m.includes("原因：这周排满了"))).toBe(true);
    const again = await command(FRONT, "handoff_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: back.version,
      toUserId: users[TEST],
      note: "换你",
    });
    expect(again.pending_owner_id).toBe(users[TEST]);
  });

  test("接手前可以撤回；撤回后接手人不能再接手", async () => {
    const w = await team();
    const task = await command(FRONT, "create_task", { workspaceId: w, title: "撤回", ownerId: users[BACK] });
    await expect(command(TEST, "withdraw_task", { workspaceId: w, taskId: task.id })).rejects.toThrow(/Forbidden/);
    expect(await command(FRONT, "withdraw_task", { workspaceId: w, taskId: task.id })).toMatchObject({ pending_owner_id: null });
    await expect(command(BACK, "accept_task", { workspaceId: w, taskId: task.id })).rejects.toThrow(/Only the receiver/);
  });

  test("只有接手人能接手或退回；等接手期间不能完成，也不能再交", async () => {
    const w = await team();
    const task = await command(FRONT, "create_task", { workspaceId: w, title: "限制", ownerId: users[BACK] });
    await expect(command(TEST, "accept_task", { workspaceId: w, taskId: task.id })).rejects.toThrow(/Only the receiver/);
    await expect(command(LEAD, "reject_task", { workspaceId: w, taskId: task.id, note: "x" })).rejects.toThrow(/Only the receiver/);
    await expect(command(FRONT, "complete_task", { workspaceId: w, taskId: task.id, expectedVersion: task.version })).rejects.toThrow(
      /Handoff pending/,
    );
    await expect(
      command(FRONT, "handoff_task", { workspaceId: w, taskId: task.id, expectedVersion: task.version, toUserId: users[TEST], note: "x" }),
    ).rejects.toThrow(/Handoff pending/);
  });

  test("交接必须写说明；不能交给团队外的人或现在的负责人", async () => {
    const w = await team();
    const task = await command(FRONT, "create_task", { workspaceId: w, title: "校验", ownerId: users[FRONT] });
    const base = { workspaceId: w, taskId: task.id, expectedVersion: task.version };
    await expect(command(FRONT, "handoff_task", { ...base, toUserId: users[BACK], note: "" })).rejects.toThrow(/Invalid note/);
    await expect(command(FRONT, "handoff_task", { ...base, toUserId: users[FRONT], note: "x" })).rejects.toThrow(/Already the owner/);
    await expect(command(FRONT, "handoff_task", { ...base, toUserId: "99999999-9999-4999-8999-999999999999", note: "x" })).rejects.toThrow(
      /team member/,
    );
  });

  test("别人手上的事不能替他完成；旧版本的操作会被拒绝", async () => {
    const w = await team();
    const task = await command(FRONT, "create_task", { workspaceId: w, title: "冲突", ownerId: users[FRONT] });
    await expect(command(BACK, "complete_task", { workspaceId: w, taskId: task.id, expectedVersion: task.version })).rejects.toThrow(
      /Forbidden/,
    );
    await expect(command(LEAD, "complete_task", { workspaceId: w, taskId: task.id, expectedVersion: task.version })).rejects.toThrow(
      /Forbidden/,
    );
    await command(FRONT, "complete_task", { workspaceId: w, taskId: task.id, expectedVersion: task.version });
    await expect(command(FRONT, "complete_task", { workspaceId: w, taskId: task.id, expectedVersion: task.version })).rejects.toThrow(
      /Version conflict/,
    );
  });

  test("完成后可以重新打开，回到负责人手上", async () => {
    const w = await team();
    const task = await command(FRONT, "create_task", { workspaceId: w, title: "重开", ownerId: users[FRONT] });
    const done = await command(FRONT, "complete_task", { workspaceId: w, taskId: task.id, expectedVersion: task.version });
    await expect(command(BACK, "reopen_task", { workspaceId: w, taskId: task.id, expectedVersion: done.version })).rejects.toThrow(
      /Forbidden/,
    );
    expect(await command(LEAD, "reopen_task", { workspaceId: w, taskId: task.id, expectedVersion: done.version })).toMatchObject({
      status: "open",
    });
  });

  test("没交接过的自己的待办可以删；流转过的不能删", async () => {
    const w = await team();
    const own = await command(FRONT, "create_task", { workspaceId: w, title: "写错了", ownerId: users[FRONT] });
    await expect(command(BACK, "delete_task", { workspaceId: w, taskId: own.id })).rejects.toThrow(/Forbidden/);
    await command(FRONT, "delete_task", { workspaceId: w, taskId: own.id });
    expect(await visibleTitles(FRONT, w)).toEqual([]);

    const moved = await command(FRONT, "create_task", { workspaceId: w, title: "流转过", ownerId: users[BACK] });
    await command(BACK, "reject_task", { workspaceId: w, taskId: moved.id, note: "不是我的" });
    await expect(command(FRONT, "delete_task", { workspaceId: w, taskId: moved.id })).rejects.toThrow(/Forbidden/);
  });
});

describe("谁能看到什么", () => {
  test("管理者看全队；其他人只看到自己写的、手上的、等接手的和经手过的", async () => {
    const w = await team();
    await command(FRONT, "create_task", { workspaceId: w, title: "前端自己的", ownerId: users[FRONT] });
    const passed = await command(FRONT, "create_task", { workspaceId: w, title: "前端交给后端", ownerId: users[BACK], note: "请接手" });
    const accepted = await command(BACK, "accept_task", { workspaceId: w, taskId: passed.id });
    await command(BACK, "handoff_task", {
      workspaceId: w,
      taskId: passed.id,
      expectedVersion: accepted.version,
      toUserId: users[TEST],
      note: "请测试",
    });

    expect(await visibleTitles(LEAD, w)).toEqual(["前端交给后端", "前端自己的"]);
    expect(await visibleTitles(FRONT, w)).toEqual(["前端交给后端", "前端自己的"]);
    // 后端已经交出去，经手过所以还能看到；看不到前端自己的事
    expect(await visibleTitles(BACK, w)).toEqual(["前端交给后端"]);
    expect(await visibleTitles(TEST, w)).toEqual(["前端交给后端"]);

    const snapshot = await command(TEST, "snapshot", { workspaceId: w });
    expect(snapshot.activities.every((a: any) => a.task_id === passed.id)).toBe(true);
    expect(snapshot.invites).toEqual([]);
  });

  test("看不到的事也不能操作", async () => {
    const w = await team();
    const task = await command(FRONT, "create_task", { workspaceId: w, title: "秘密", ownerId: users[FRONT] });
    await expect(
      command(BACK, "handoff_task", {
        workspaceId: w,
        taskId: task.id,
        expectedVersion: task.version,
        toUserId: users[BACK],
        note: "拿走",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("其他团队的人读不到；浏览器不能绕过函数直接读表", async () => {
    const w = await team();
    const other = (await command(TEST, "create_workspace", { name: "别的组" })).id;
    await expect(command(LEAD, "snapshot", { workspaceId: other })).rejects.toThrow(/Forbidden/);
    await expect(command(LEAD, "create_task", { workspaceId: other, title: "x", ownerId: users[LEAD] })).rejects.toThrow(/Forbidden/);
    await command(FRONT, "snapshot", { workspaceId: w });
    for (const table of ["wt_tasks", "wt_activities", "wt_contacts", "wt_outbox", "wt_members"]) {
      await expect(db.query(`select * from public.${table}`)).rejects.toThrow(/permission denied/i);
    }
  });

  test("手机号只有自己能读到", async () => {
    const w = await team();
    await command(BACK, "update_profile", { displayName: "后端", mobile: "13800000002" });
    await expect(command(BACK, "update_profile", { displayName: "后端", mobile: "123" })).rejects.toThrow(/Invalid mobile/);
    expect((await command(BACK, "snapshot", { workspaceId: w })).my_mobile).toBe("13800000002");
    const lead = await command(LEAD, "snapshot", { workspaceId: w });
    expect(lead.my_mobile).toBe("");
    expect(JSON.stringify(lead)).not.toContain("13800000002");
  });
});

describe("修改标题和日期", () => {
  test("负责人能改，改动留在流转里；管理者代改要通知负责人", async () => {
    const w = await team();
    const task = await command(BACK, "create_task", { workspaceId: w, title: "旧标题", ownerId: users[BACK], dueDate: "2026-11-10" });
    const changed = await command(BACK, "update_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: task.version,
      title: "新标题",
      dueDate: "2026-11-12",
    });
    expect(changed).toMatchObject({ title: "新标题", due_date: "2026-11-12", version: task.version + 1 });
    const snapshot = await command(BACK, "snapshot", { workspaceId: w });
    const edited = snapshot.activities.find((a: any) => a.task_id === task.id && a.action === "edited");
    expect(edited.detail).toEqual({ title: "新标题", due: "2026-11-12" });

    const cleared = await command(LEAD, "update_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: changed.version,
      title: "新标题",
      dueDate: null,
    });
    expect(cleared.due_date).toBeNull();
    expect(await pendingMessages()).toContainEqual(expect.stringContaining("【已修改】"));
  });

  test("没有改动不留记录；无关的人、旧版本、交接中和完成后都不能改", async () => {
    const w = await team();
    const task = await command(BACK, "create_task", { workspaceId: w, title: "事项", ownerId: users[BACK] });
    const update = (index: number, fields = {}) =>
      command(index, "update_task", { workspaceId: w, taskId: task.id, expectedVersion: task.version, title: "事项", ...fields });

    const same = await update(BACK);
    expect(same.version).toBe(task.version);
    expect(await activityOf(BACK, w, task.id)).toEqual(["created"]);

    await expect(update(TEST, { title: "偷改" })).rejects.toThrow(/Forbidden|Task not found/);
    await expect(update(BACK, { expectedVersion: task.version + 5, title: "过期" })).rejects.toThrow(/Version conflict/);
    await expect(update(BACK, { title: " " })).rejects.toThrow(/Invalid title/);

    const sent = await command(BACK, "handoff_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: task.version,
      toUserId: users[TEST],
      note: "请接手",
    });
    await expect(update(BACK, { expectedVersion: sent.version, title: "交接中改" })).rejects.toThrow(/Handoff pending/);
    await command(BACK, "withdraw_task", { workspaceId: w, taskId: task.id });
    const current = (await command(BACK, "snapshot", { workspaceId: w })).tasks.find((t: any) => t.id === task.id);
    const done = await command(BACK, "complete_task", { workspaceId: w, taskId: task.id, expectedVersion: current.version });
    await expect(update(BACK, { expectedVersion: done.version, title: "完成后改" })).rejects.toThrow(/Task done/);
  });
});

describe("团队管理", () => {
  test("只有管理者能邀请；邀请码只能用一次", async () => {
    const w = (await command(LEAD, "create_workspace", { name: "新组" })).id;
    const invite = await command(LEAD, "invite", { workspaceId: w });
    await command(FRONT, "join_workspace", { code: invite.code });
    await expect(command(BACK, "join_workspace", { code: invite.code })).rejects.toThrow(/Invalid or expired/);
    await expect(command(FRONT, "invite", { workspaceId: w })).rejects.toThrow(/Forbidden/);
  });

  test("手上还有事的人不能移除；交出去之后可以", async () => {
    const w = await team();
    const task = await command(BACK, "create_task", { workspaceId: w, title: "离职交接", ownerId: users[BACK] });
    const remove = () => command(LEAD, "update_member", { workspaceId: w, userId: users[BACK], role: null });
    await expect(remove()).rejects.toThrow(/Reassign open tasks/);
    // 负责人联系不上时，管理者可以代为交接
    await command(LEAD, "handoff_task", {
      workspaceId: w,
      taskId: task.id,
      expectedVersion: task.version,
      toUserId: users[FRONT],
      note: "后端离职",
    });
    await command(FRONT, "accept_task", { workspaceId: w, taskId: task.id });
    await remove();
    expect((await command(LEAD, "snapshot", { workspaceId: w })).members.map((m: any) => m.user_id)).not.toContain(users[BACK]);
    await expect(command(BACK, "snapshot", { workspaceId: w })).rejects.toThrow(/Forbidden/);
  });

  test("可以把成员设为管理者，所有者不能被修改", async () => {
    const w = await team();
    await expect(command(FRONT, "update_member", { workspaceId: w, userId: users[BACK], role: "admin" })).rejects.toThrow(/Forbidden/);
    await command(LEAD, "update_member", { workspaceId: w, userId: users[BACK], role: "admin" });
    expect((await command(BACK, "snapshot", { workspaceId: w })).invites).toEqual([]);
    await command(BACK, "invite", { workspaceId: w });
    await expect(command(BACK, "update_member", { workspaceId: w, userId: users[LEAD], role: null })).rejects.toThrow(/owner is protected/);
  });
});
