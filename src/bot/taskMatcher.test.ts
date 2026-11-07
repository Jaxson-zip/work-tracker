import { describe, expect, it } from "vitest";
import type { MemoItem } from "../types";
import { findBestOpenTaskMatch, sortOpenTasksForBot } from "./taskMatcher";

const baseItem: MemoItem = {
  id: "11111111-1111-4111-8111-111111111111",
  listId: null,
  title: "复习英语",
  body: "",
  kind: "task",
  status: "open",
  priority: "normal",
  repeatRule: "none",
  dueDate: "2026-06-04",
  reminderAt: null,
  tags: [],
  pinned: false,
  archived: false,
  deletedAt: null,
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:00:00.000Z",
};

describe("findBestOpenTaskMatch", () => {
  it("matches by exact title before partial title text", () => {
    const exact = { ...baseItem, id: "22222222-2222-4222-8222-222222222222", title: "英语" };

    expect(findBestOpenTaskMatch([baseItem, exact], "英语")?.id).toBe(exact.id);
  });

  it("matches by included title text", () => {
    expect(findBestOpenTaskMatch([baseItem], "英语")?.id).toBe(baseItem.id);
  });

  it("ignores done, archived, deleted, and purged tasks", () => {
    const blocked = [
      { ...baseItem, id: "22222222-2222-4222-8222-222222222222", status: "done" as const },
      { ...baseItem, id: "33333333-3333-4333-8333-333333333333", archived: true },
      { ...baseItem, id: "44444444-4444-4444-8444-444444444444", deletedAt: "2026-06-04T00:00:00.000Z" },
      { ...baseItem, id: "55555555-5555-4555-8555-555555555555", status: "purged" as const },
    ];

    expect(findBestOpenTaskMatch(blocked, "英语")).toBeNull();
  });
});

describe("sortOpenTasksForBot", () => {
  it("sorts tasks by reminder, due date, and newest update", () => {
    const newestNoDate = { ...baseItem, id: "22222222-2222-4222-8222-222222222222", title: "无日期", dueDate: null, updatedAt: "2026-06-04T10:00:00.000Z" };
    const dueSoon = { ...baseItem, id: "33333333-3333-4333-8333-333333333333", title: "今天到期", dueDate: "2026-06-04" };
    const reminderSoon = {
      ...baseItem,
      id: "44444444-4444-4444-8444-444444444444",
      title: "九点提醒",
      reminderAt: "2026-06-04T01:00:00.000Z",
    };

    expect(sortOpenTasksForBot([newestNoDate, dueSoon, reminderSoon]).map((item) => item.title)).toEqual([
      "九点提醒",
      "今天到期",
      "无日期",
    ]);
  });
});
