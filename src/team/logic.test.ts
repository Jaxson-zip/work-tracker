import { describe, expect, it } from "vitest";
import {
  canEdit,
  chainNodes,
  dueLabel,
  firstTask,
  handoffChain,
  lastRejection,
  myLists,
  sourceOf,
  taskActions,
  teamGroups,
  waitText,
  whereNow,
} from "./logic";
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

  it("管理者只是改过标题或日期，不算经手，不进我的列表", () => {
    const other = task({ id: "other", owner_id: "test", created_by: "back" });
    expect(myLists([other], [activity("me", "edited", { due: null }, "other")], "me").passed).toEqual([]);
  });

  it("全队先列交接中的，再按人分组，已完成单独放", () => {
    const groups = teamGroups(
      [
        task({ id: "moving", pending_owner_id: "back", handoff_by: "me" }),
        task({ id: "mine" }),
        task({ id: "theirs", owner_id: "back" }),
        task({ id: "finished", status: "done" }),
      ],
      members,
    );
    expect(groups.moving.map((t) => t.id)).toEqual(["moving"]);
    expect(groups.holders.map((h) => [h.member.user_id, h.tasks.map((t) => t.id)])).toEqual([
      ["me", ["mine"]],
      ["back", ["theirs"]],
    ]);
    expect(groups.done.map((t) => t.id)).toEqual(["finished"]);
  });

  it("默认打开最该处理的：先等我接手，再我手上的，再交出去的", () => {
    const incoming = task({ id: "incoming", owner_id: "back", created_by: "back", pending_owner_id: "me" });
    const mine = task({ id: "mine" });
    const sent = task({ id: "sent", owner_id: "back" });
    expect(firstTask([sent, mine, incoming], [], "me", false)?.id).toBe("incoming");
    expect(firstTask([sent, mine], [], "me", false)?.id).toBe("mine");
    expect(firstTask([sent], [], "me", false)?.id).toBe("sent");
    expect(firstTask([], [], "me", false)).toBeNull();
    expect(firstTask([task({ id: "late", due_date: "2026-11-01" }), mine], [], "boss", true)?.id).toBe("late");
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
    expect(sourceOf(task(), [activity("me", "created")], members, "me")).toBe("自己写的");
    const moved = task({ owner_id: "test", created_by: "me" });
    expect(sourceOf(moved, [activity("test", "accepted", { from: "back" })], members, "me")).toBe("后端 交来的");
    expect(sourceOf(task({ owner_id: "back", created_by: "me" }), [], members, "me")).toBe("我 写的");
  });

  it("等我接手时，来源是正在交给我的人，不是更早的上一手", () => {
    const pending = task({ owner_id: "back", created_by: "me", pending_owner_id: "me", handoff_by: "back" });
    expect(sourceOf(pending, [activity("back", "accepted", { from: "me" })], members, "me")).toBe("后端 交来的");
  });

  it("交出去的人看这条待办，来源不会变成“自己交来的”", () => {
    const written = task({ created_by: "me", owner_id: "me", pending_owner_id: "back", handoff_by: "me" });
    expect(sourceOf(written, [activity("me", "created")], members, "me")).toBe("自己写的");
    const relayed = task({ created_by: "back", owner_id: "me", pending_owner_id: "test", handoff_by: "me" });
    expect(sourceOf(relayed, [activity("me", "accepted", { from: "back" })], members, "me")).toBe("后端 交来的");
  });

  it("管理者看别人写的事，不显示“自己写的”", () => {
    const others = task({ created_by: "back", owner_id: "back", pending_owner_id: "test", handoff_by: "back" });
    expect(sourceOf(others, [activity("back", "created")], members, "me")).toBe("后端 写的");
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

  it("交接链标出每个人的状态", () => {
    const moved = [activity("me", "created"), activity("back", "accepted", { from: "me" })];
    expect(chainNodes(task({ owner_id: "back" }), moved)).toEqual([
      { id: "me", state: "past" },
      { id: "back", state: "now" },
    ]);
    expect(chainNodes(task({ owner_id: "back", pending_owner_id: "test" }), moved)).toEqual([
      { id: "me", state: "past" },
      { id: "back", state: "past" },
      { id: "test", state: "wait" },
    ]);
    expect(chainNodes(task({ owner_id: "back", status: "done" }), moved)[1]).toEqual({ id: "back", state: "done" });
    expect(chainNodes(task(), [])).toEqual([{ id: "me", state: "now" }]);
  });

  it("退回提示只在退回是最后一个动作时出现", () => {
    const rejected = activity("back", "rejected", { note: "排满了" });
    expect(lastRejection([activity("me", "handoff"), rejected])).toBe(rejected);
    expect(lastRejection([rejected, activity("me", "handoff")])).toBeNull();
    expect(lastRejection([])).toBeNull();
  });

  it("退回后改了日期，退回原因还在", () => {
    const rejected = activity("back", "rejected", { note: "排满了" });
    expect(lastRejection([rejected, activity("me", "edited", { due: "2026-11-09" })])).toBe(rejected);
  });

  it("交接等待时长：不到 1 小时、几小时、几天，从最近一次交出开始算", () => {
    const sentAt = "2026-11-07T00:00:00Z";
    const sent = { ...activity("me", "handoff"), created_at: sentAt };
    const pending = task({ pending_owner_id: "back", handoff_by: "me" });
    const after = (hours: number) => Date.parse(sentAt) + hours * 3600000;
    expect(waitText(pending, [sent], after(0.5))).toBe("等了不到 1 小时");
    expect(waitText(pending, [sent], after(7))).toBe("等了 7 小时");
    expect(waitText(pending, [sent], after(50))).toBe("等了 2 天");
    expect(waitText(task(), [sent], after(50))).toBeNull();
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

  it("只有自己写的、没交接过的才能删", () => {
    expect(actions(task())).toContain("delete");
    expect(actions(task(), "me", "member", [activity("me", "handoff")])).not.toContain("delete");
    expect(actions(task({ created_by: "back" }))).not.toContain("delete");
  });

  it("负责人和管理者能改标题和日期；交接中和完成后不能改", () => {
    expect(canEdit(task(), "me", "member")).toBe(true);
    expect(canEdit(task(), "stranger", "member")).toBe(false);
    expect(canEdit(task(), "boss", "admin")).toBe(true);
    expect(canEdit(task({ pending_owner_id: "back" }), "me", "member")).toBe(false);
    expect(canEdit(task({ status: "done" }), "me", "member")).toBe(false);
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
