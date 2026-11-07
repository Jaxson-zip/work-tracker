import { describe, expect, it } from "vitest";
import { dueLabel, handoffChain, lastRejection, myLists, rowActions, sourceOf, taskActions, teamLists, whereNow } from "./logic";
import type { Member, TaskActivity, TeamTask } from "./types";

const task = (patch: Partial<TeamTask> = {}): TeamTask => ({
  id: "t",
  title: "事项",
  owner_id: "me",
  created_by: "me",
  status: "open",
  due_date: null,
  version: 1,
  pending_owner_id: null,
  handoff_by: null,
  handoff_note: "",
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  ...patch,
});
const activity = (actor_id: string, action: TaskActivity["action"], detail: TaskActivity["detail"] = {}, task_id = "t"): TaskActivity => ({
  id: `${actor_id}-${action}`,
  task_id,
  actor_id,
  action,
  detail,
  created_at: "2026-11-01T00:00:00Z",
});
const members: Member[] = [
  { user_id: "me", role: "member", display_name: "我" },
  { user_id: "back", role: "member", display_name: "后端" },
  { user_id: "test", role: "member", display_name: "测试" },
];

describe("我的页面分组", () => {
  it("等我接手、我手上的、交出去的、已完成，每条只出现一次", () => {
    const tasks = [
      task({ id: "incoming", owner_id: "back", created_by: "back", pending_owner_id: "me" }),
      task({ id: "mine" }),
      task({ id: "sent", pending_owner_id: "back", handoff_by: "me" }),
      task({ id: "moved", owner_id: "back" }),
      task({ id: "finished", status: "done" }),
    ];
    const lists = myLists(tasks, [], "me");
    expect(lists.incoming.map((t) => t.id)).toEqual(["incoming"]);
    expect(lists.mine.map((t) => t.id)).toEqual(["mine"]);
    expect(lists.passed.map((t) => t.id)).toEqual(["sent", "moved"]);
    expect(lists.done.map((t) => t.id)).toEqual(["finished"]);
  });

  it("经手过的算我的；和我无关的（管理者能读到）不进我的列表", () => {
    const tasks = [
      task({ id: "relay", owner_id: "test", created_by: "back" }),
      task({ id: "other", owner_id: "test", created_by: "back" }),
    ];
    const lists = myLists(tasks, [activity("me", "accepted", {}, "relay")], "me");
    expect(lists.passed.map((t) => t.id)).toEqual(["relay"]);
  });

  it("逾期的排最前，没有日期的排最后", () => {
    const tasks = [task({ id: "none" }), task({ id: "late", due_date: "2026-11-01" }), task({ id: "soon", due_date: "2026-11-09" })];
    expect(myLists(tasks, [], "me").mine.map((t) => t.id)).toEqual(["late", "soon", "none"]);
  });

  it("全队视图分未完成和已完成", () => {
    const lists = teamLists([task({ id: "a" }), task({ id: "b", status: "done" })]);
    expect(lists.open.map((t) => t.id)).toEqual(["a"]);
    expect(lists.done.map((t) => t.id)).toEqual(["b"]);
  });
});

describe("流转显示", () => {
  it("一句话说清事情在哪", () => {
    expect(whereNow(task({ pending_owner_id: "back" }), members, "me")).toBe("等后端接手");
    expect(whereNow(task({ pending_owner_id: "me" }), members, "me")).toBe("等你接手");
    expect(whereNow(task({ owner_id: "back" }), members, "me")).toBe("在后端手上");
    expect(whereNow(task({ owner_id: "back", status: "done" }), members, "me")).toBe("后端已完成");
  });

  it("来源：谁交来的，或者自己写的", () => {
    expect(sourceOf(task(), [activity("me", "created")], members)).toBe("自己写的");
    const moved = task({ owner_id: "test", created_by: "me" });
    expect(sourceOf(moved, [activity("test", "accepted", { from: "back" })], members)).toBe("后端 交来的");
    expect(sourceOf(task({ owner_id: "back", created_by: "me" }), [], members)).toBe("我 写的");
  });

  it("等人接手时，来源是正在交接的人，不是更早的上一手", () => {
    const pending = task({ owner_id: "back", created_by: "me", pending_owner_id: "me", handoff_by: "back" });
    expect(sourceOf(pending, [activity("back", "accepted", { from: "me" })], members)).toBe("后端 交来的");
  });

  it("交接链只算真正接手的人，退回和撤回不算", () => {
    const history = [
      activity("me", "created"),
      activity("me", "handoff", { to: "test" }),
      activity("test", "rejected", { note: "不行" }),
      activity("me", "handoff", { to: "back" }),
      activity("back", "accepted", { from: "me" }),
      activity("back", "handoff", { to: "test" }),
      activity("test", "accepted", { from: "back" }),
    ];
    expect(handoffChain(task({ owner_id: "test" }), history)).toEqual(["me", "back", "test"]);
  });

  it("退回提示只在退回是最后一个动作时出现", () => {
    const rejected = activity("back", "rejected", { note: "排满了" });
    expect(lastRejection([activity("me", "handoff"), rejected])).toBe(rejected);
    expect(lastRejection([rejected, activity("me", "handoff")])).toBeNull();
    expect(lastRejection([])).toBeNull();
  });
});

describe("按钮和数据库权限一致", () => {
  const actions = (t: TeamTask, user = "me", role: Member["role"] = "member", history: TaskActivity[] = []) =>
    taskActions(t, history, user, role);

  it("接手人只能接手或退回；发起人只能撤回；无关的人没有操作", () => {
    const pending = task({ pending_owner_id: "back", handoff_by: "me" });
    expect(actions(pending, "back")).toEqual(["accept", "reject"]);
    expect(actions(pending, "me")).toEqual(["withdraw"]);
    expect(actions(pending, "test")).toEqual([]);
    expect(actions(pending, "test", "admin")).toEqual(["withdraw"]);
  });

  it("手上的事可以完成和交给下一位；管理者只能代为交接，不能代为完成", () => {
    expect(actions(task(), "me", "member", [activity("me", "handoff")])).toEqual(["complete", "handoff"]);
    expect(actions(task(), "boss", "admin")).toEqual(["handoff"]);
    expect(actions(task(), "stranger")).toEqual([]);
  });

  it("列表行只放自己手上的操作；管理者代为交接、删除、重新打开都在详情里", () => {
    const row = (t: TeamTask, user = "me", role: Member["role"] = "member") => rowActions(t, [], user, role);
    expect(row(task())).toEqual(["complete", "handoff"]);
    expect(row(task({ owner_id: "back", created_by: "back" }), "boss", "admin")).toEqual([]);
    expect(row(task({ pending_owner_id: "back", handoff_by: "me" }))).toEqual(["withdraw"]);
    expect(row(task({ status: "done" }))).toEqual([]);
  });

  it("只有自己写的、没交接过的才能删", () => {
    expect(actions(task())).toContain("delete");
    expect(actions(task(), "me", "member", [activity("me", "handoff")])).not.toContain("delete");
    expect(actions(task({ created_by: "back" }))).not.toContain("delete");
  });

  it("完成后只能重新打开", () => {
    expect(actions(task({ status: "done" }))).toEqual(["reopen"]);
    expect(actions(task({ status: "done", owner_id: "back", created_by: "back" }))).toEqual([]);
    expect(actions(task({ status: "done", owner_id: "back", created_by: "back" }), "boss", "admin")).toEqual(["reopen"]);
  });
});

describe("截止日期", () => {
  it("用人话说", () => {
    expect(dueLabel("2026-11-05", "2026-11-07")).toEqual({ text: "逾期 2 天", overdue: true });
    expect(dueLabel("2026-11-07", "2026-11-07").text).toBe("今天到期");
    expect(dueLabel("2026-11-08", "2026-11-07").text).toBe("明天到期");
    expect(dueLabel("2026-12-03", "2026-11-07").text).toBe("12月3日到期");
  });
});
