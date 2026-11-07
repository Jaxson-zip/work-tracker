import { describe, expect, it } from "vitest";
import { parseBotIntent } from "./intent";

const baseDate = new Date("2026-06-04T08:00:00+08:00");

describe("parseBotIntent", () => {
  it("parses bind commands", () => {
    expect(parseBotIntent("绑定 TD-839201", baseDate)).toEqual({
      type: "bind",
      code: "TD-839201",
    });
    expect(parseBotIntent("绑定 TD-1234567890", baseDate)).toEqual({
      type: "bind",
      code: "TD-1234567890",
    });
    expect(parseBotIntent("bind td839201", baseDate)).toEqual({
      type: "bind",
      code: "TD839201",
    });
  });

  it("parses today-list commands", () => {
    expect(parseBotIntent("今天有什么没完成", baseDate)).toEqual({ type: "listToday" });
    expect(parseBotIntent("我今天还有什么没完成", baseDate)).toEqual({ type: "listToday" });
    expect(parseBotIntent("今天还有哪些未完成任务", baseDate)).toEqual({ type: "listToday" });
    expect(parseBotIntent("我今天还要做什么", baseDate)).toEqual({ type: "listToday" });
    expect(parseBotIntent("我今天还有什么事要做", baseDate)).toEqual({ type: "listToday" });
    expect(parseBotIntent("今日任务", baseDate)).toEqual({ type: "listToday" });
  });

  it("parses open-list commands", () => {
    expect(parseBotIntent("任务列表", baseDate)).toEqual({ type: "listOpen" });
    expect(parseBotIntent("人物列表", baseDate)).toEqual({ type: "listOpen" });
    expect(parseBotIntent("未完成任务", baseDate)).toEqual({ type: "listOpen" });
    expect(parseBotIntent("我还有什么没完成", baseDate)).toEqual({ type: "listOpen" });
    expect(parseBotIntent("tasks", baseDate)).toEqual({ type: "listOpen" });
  });

  it("parses done commands", () => {
    expect(parseBotIntent("完成 复习英语", baseDate)).toEqual({
      type: "complete",
      query: "复习英语",
    });
    expect(parseBotIntent("完成", baseDate)).toEqual({
      type: "completeRecent",
    });
    expect(parseBotIntent("搞定了", baseDate)).toEqual({
      type: "completeRecent",
    });
    expect(parseBotIntent("done homework", baseDate)).toEqual({
      type: "complete",
      query: "homework",
    });
  });

  it("parses delete commands", () => {
    expect(parseBotIntent("删除 复习英语", baseDate)).toEqual({
      type: "delete",
      query: "复习英语",
    });
    expect(parseBotIntent("清理所有任务", baseDate)).toEqual({
      type: "deleteAllTasks",
    });
    expect(parseBotIntent("清空待办", baseDate)).toEqual({
      type: "deleteAllTasks",
    });
    expect(parseBotIntent("delete homework", baseDate)).toEqual({
      type: "delete",
      query: "homework",
    });
  });

  it("parses snooze commands", () => {
    expect(parseBotIntent("稍后10分钟提醒", baseDate)).toEqual({
      type: "snooze",
      minutes: 10,
    });
  });

  it("keeps simple acknowledgements silent", () => {
    expect(parseBotIntent("好", baseDate)).toEqual({ type: "ack" });
    expect(parseBotIntent("收到", baseDate)).toEqual({ type: "ack" });
  });

  it("parses create commands through the task input parser", () => {
    const intent = parseBotIntent("明天上午10点交作业", baseDate);

    expect(intent.type).toBe("createTask");
    if (intent.type !== "createTask") throw new Error("expected createTask");
    expect(intent.title).toBe("交作业");
    expect(intent.repeatRule).toBe("none");
    expect(intent.dueDate).toBe("2026-06-05");
    expect(new Date(intent.reminderAt ?? "").getTime()).toBe(new Date("2026-06-05T02:00:00.000Z").getTime());
    expect(new Date(intent.eventAt ?? "").getTime()).toBe(new Date("2026-06-05T02:00:00.000Z").getTime());
  });

  it("cleans assistant-style reminder prefixes from task titles", () => {
    const intent = parseBotIntent("今晚10点提醒我健身打卡", baseDate);

    expect(intent.type).toBe("createTask");
    if (intent.type !== "createTask") throw new Error("expected createTask");
    expect(intent.title).toBe("健身打卡");
    expect(new Date(intent.reminderAt ?? "").getHours()).toBe(22);
  });

  it("parses time ranges from WeChat shorthand", () => {
    const intent = parseBotIntent("明天下午5.到7.打球", new Date("2026-06-05T15:00:00+08:00"));

    expect(intent.type).toBe("createTask");
    if (intent.type !== "createTask") throw new Error("expected createTask");
    expect(intent.title).toBe("打球");
    expect(new Date(intent.eventAt ?? "").getHours()).toBe(17);
    expect(new Date(intent.endAt ?? "").getHours()).toBe(19);
  });

  it("parses create commands with an early reminder offset", () => {
    const intent = parseBotIntent("明天上午10点交作业，提前30分钟提醒", baseDate);

    expect(intent.type).toBe("createTask");
    if (intent.type !== "createTask") throw new Error("expected createTask");
    expect(intent.title).toBe("交作业");
    expect(intent.dueDate).toBe("2026-06-05");
    expect(new Date(intent.reminderAt ?? "").getTime()).toBe(new Date("2026-06-05T01:30:00.000Z").getTime());
    expect(new Date(intent.eventAt ?? "").getTime()).toBe(new Date("2026-06-05T02:00:00.000Z").getTime());
  });

  it("splits several scheduled tasks from one message", () => {
    const intent = parseBotIntent("周三下午3点客户demo、周五早9点的高铁提前1小时叫我、每周二晚8点私教课循环", baseDate);

    expect(intent.type).toBe("createTasks");
    if (intent.type !== "createTasks") throw new Error("expected createTasks");
    expect(intent.items.map((item) => item.title)).toEqual(["客户demo", "高铁", "私教课"]);
    expect(intent.items.map((item) => item.repeatRule)).toEqual(["none", "none", "weekly"]);
    expect(new Date(intent.items[1].eventAt ?? "").getHours()).toBe(9);
    expect(new Date(intent.items[1].reminderAt ?? "").getHours()).toBe(8);
  });

  it("parses lightweight record commands as notes", () => {
    const intent = parseBotIntent("记录一下，今天体重 66.7", baseDate);

    expect(intent).toEqual({
      type: "createNote",
      title: "体重 66.7kg",
      body: "今天体重 66.7",
      raw: "记录一下，今天体重 66.7",
    });
  });
});
