import { describe, expect, it } from "vitest";
import { mergeItemsByNewest, mergeListsByNewest } from "./supabase";
import type { MemoItem, MemoList } from "./types";

function makeItem(overrides: Partial<MemoItem> = {}): MemoItem {
  return {
    id: "item-1",
    listId: "list-1",
    title: "Task",
    body: "",
    kind: "task",
    status: "open",
    priority: "normal",
    repeatRule: "none",
    dueDate: null,
    reminderAt: null,
    tags: [],
    pinned: false,
    archived: false,
    deletedAt: null,
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
    ...overrides,
  };
}

function makeList(overrides: Partial<MemoList> = {}): MemoList {
  return {
    id: "list-1",
    name: "List",
    emoji: "🛠",
    archived: false,
    deletedAt: null,
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeItemsByNewest", () => {
  it("keeps purged tombstones over newer non-purged copies", () => {
    const purged = makeItem({
      status: "purged",
      deletedAt: "2026-04-24T01:00:00.000Z",
      updatedAt: "2026-04-24T01:00:00.000Z",
    });
    const staleOpen = makeItem({
      status: "open",
      deletedAt: null,
      updatedAt: "2026-04-24T05:00:00.000Z",
    });

    const merged = mergeItemsByNewest([purged], [staleOpen]);

    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("purged");
  });

  it("keeps cleared demo items from coming back under a different id", () => {
    const clearedDemo = makeItem({
      id: "local-demo",
      title: "点击输入框，创建任务",
      status: "purged",
      deletedAt: "2026-04-24T01:00:00.000Z",
      updatedAt: "2026-04-24T01:00:00.000Z",
    });
    const staleRemoteDemo = makeItem({
      id: "remote-demo",
      title: "点击输入框，创建任务",
      status: "open",
      deletedAt: null,
      updatedAt: "2026-04-24T05:00:00.000Z",
    });

    const merged = mergeItemsByNewest([clearedDemo], [staleRemoteDemo]);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("local-demo");
    expect(merged[0].status).toBe("purged");
  });
});

describe("mergeListsByNewest", () => {
  it("keeps deleted tombstones over newer active copies", () => {
    const deleted = makeList({
      deletedAt: "2026-04-24T01:00:00.000Z",
      updatedAt: "2026-04-24T01:00:00.000Z",
    });
    const staleActive = makeList({
      deletedAt: null,
      updatedAt: "2026-04-24T05:00:00.000Z",
    });

    const merged = mergeListsByNewest([deleted], [staleActive]);

    expect(merged).toHaveLength(1);
    expect(merged[0].deletedAt).toBe("2026-04-24T01:00:00.000Z");
  });
});
