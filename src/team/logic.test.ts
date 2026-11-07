import { describe, expect, it } from "vitest";
import { dueLabel, focusGroups, focusSummary, membersByDepartment, taskActions } from "./logic";
import type { Member, TeamTask } from "./types";

const TODAY = "2026-11-07";
const task = (patch: Partial<TeamTask> = {}): TeamTask => ({
  id: "t",
  workspace_id: "w",
  title: "事项",
  body: "",
  owner_id: "me",
  created_by: "me",
  status: "in_progress",
  priority: "normal",
  due_date: null,
  follow_up_date: null,
  next_action: "",
  version: 1,
  source_record_id: null,
  pending_owner_id: null,
  handoff_by: null,
  handoff_note: "",
  returned_to: null,
  returned_by: null,
  returned_note: "",
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  ...patch,
});
const keysOf = (tasks: TeamTask[]) => Object.fromEntries(focusGroups(tasks, "me", TODAY).map((g) => [g.key, g.tasks.map((t) => t.id)]));
const labels = (t: TeamTask, user = "me", role: "owner" | "admin" | "member" = "member") => taskActions(t, user, role).map((a) => a.label);

describe("我的事项分组", () => {
  it("每件事只出现一次，按先做什么排序", () => {
    const groups = focusGroups(
      [
        task({ id: "later", due_date: "2026-12-01" }),
        task({ id: "nodate" }),
        task({ id: "today", due_date: TODAY }),
        task({ id: "follow", follow_up_date: "2026-11-06" }),
        task({ id: "late", due_date: "2026-11-01" }),
        task({ id: "blocked", status: "blocked" }),
        task({ id: "incoming", owner_id: "other", created_by: "other", pending_owner_id: "me" }),
        task({ id: "returned", returned_to: "me", due_date: "2026-11-01" }),
        task({ id: "check", owner_id: "other", status: "review" }),
        task({ id: "sent", pending_owner_id: "other", due_date: "2026-11-01" }),
        task({ id: "submitted", created_by: "other", status: "review" }),
      ],
      "me",
      TODAY,
    );
    expect(groups.map((g) => g.key)).toEqual(["incoming", "returned", "review", "overdue", "today", "blocked", "later", "waiting"]);
    const ids = groups.flatMap((g) => g.tasks.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(11);
  });

  it("不属于我的、已结束的事不出现", () => {
    expect(
      keysOf([
        task({ id: "theirs", owner_id: "other", created_by: "other" }),
        task({ id: "done", status: "done" }),
        task({ id: "cancelled", status: "cancelled" }),
        task({ id: "created-not-review", owner_id: "other" }),
      ]),
    ).toEqual({});
  });

  it("关键事项排在同组最前，其次是截止日期", () => {
    const groups = focusGroups(
      [
        task({ id: "b", due_date: "2026-11-05" }),
        task({ id: "a", due_date: "2026-11-01" }),
        task({ id: "key", due_date: "2026-11-06", priority: "high" }),
      ],
      "me",
      TODAY,
    );
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["key", "a", "b"]);
  });

  it("摘要说清楚要紧的事", () => {
    expect(focusSummary([])).toBe("眼下没有紧急的事");
    expect(
      focusSummary(
        focusGroups(
          [task({ id: "x", owner_id: "o", created_by: "o", pending_owner_id: "me" }), task({ id: "y", due_date: "2026-11-01" })],
          "me",
          TODAY,
        ),
      ),
    ).toBe("1 件等你接收，1 件已逾期");
  });
});

describe("按钮和权限一致", () => {
  it("接收方只看到接收和退回，发起人只能撤回，无关的人看不到操作", () => {
    const pending = task({ owner_id: "a", created_by: "a", pending_owner_id: "me", handoff_by: "a" });
    expect(labels(pending)).toEqual(["接收", "退回"]);
    expect(labels(pending, "a")).toEqual(["撤回转交"]);
    expect(labels(pending, "stranger")).toEqual([]);
    expect(labels(pending, "boss", "admin")).toEqual(["撤回转交"]);
  });

  it("自己的事直接完成；别人交来的事提交验收，由发起人通过", () => {
    expect(labels(task())).toEqual(["完成", "标记受阻", "转交", "取消这件事"]);
    const fromOther = task({ created_by: "boss" });
    expect(labels(fromOther)).toEqual(["提交验收", "标记受阻", "转交", "取消这件事"]);
    const inReview = task({ created_by: "boss", status: "review" });
    expect(labels(inReview)).toEqual(["转交", "取消这件事"]);
    expect(labels(inReview, "boss")).toEqual(["验收通过", "退回修改", "转交", "取消这件事"]);
    expect(labels(fromOther, "stranger")).toEqual([]);
  });

  it("需要原因的操作都带提示语；只放详情里的不出现在列表行", () => {
    const actions = taskActions(task(), "me", "member");
    expect(actions.filter((a) => a.inline).map((a) => a.label)).toEqual(["完成", "转交"]);
    for (const label of ["标记受阻", "取消这件事"]) {
      const action = actions.find((a) => a.label === label);
      expect(action && "reason" in action && action.reason).toBeTruthy();
    }
  });

  it("受阻时突出恢复进行，完成只放在详情里", () => {
    const actions = taskActions(task({ status: "blocked" }), "me", "member");
    expect(actions.filter((a) => a.inline).map((a) => a.label)).toEqual(["恢复进行", "转交"]);
    expect(actions.map((a) => a.label)).toContain("完成");
  });

  it("被退回时提供知道了和转给别人；结束后只能重新打开", () => {
    expect(labels(task({ returned_to: "me" })).slice(0, 2)).toEqual(["知道了", "转给别人"]);
    expect(labels(task({ status: "done" }))).toEqual(["重新打开"]);
    expect(labels(task({ status: "done", created_by: "boss" }))).toEqual([]);
    expect(labels(task({ status: "cancelled" }))).toEqual(["重新打开"]);
  });
});

describe("显示格式", () => {
  it("截止日期用人话说", () => {
    expect(dueLabel("2026-11-05", TODAY)).toEqual({ text: "逾期 2 天", overdue: true });
    expect(dueLabel(TODAY, TODAY)).toEqual({ text: "今天到期", overdue: false });
    expect(dueLabel("2026-11-08", TODAY).text).toBe("明天到期");
    expect(dueLabel("2026-12-03", TODAY).text).toBe("12月3日到期");
  });

  it("按部门分组，没填部门的排最后", () => {
    const member = (user_id: string, department: string): Member => ({
      workspace_id: "w",
      user_id,
      role: "member",
      department,
      display_name: user_id,
    });
    expect(
      membersByDepartment([member("a", ""), member("b", "技术部"), member("c", "技术部"), member("d", "产品部")]).map((g) => [
        g.department,
        g.members.length,
      ]),
    ).toEqual([
      ["产品部", 1],
      ["技术部", 2],
      ["", 1],
    ]);
  });
});
