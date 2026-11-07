import { beforeEach, describe, expect, it } from "vitest";
import { loadItems, loadLastSync, saveItems, saveLastSync, setStorageAccount } from "./storage";
import type { MemoItem } from "./types";

const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
});
describe("personal account cache", () => {
  it("keeps signed-in accounts and guest data separate, including sync metadata", () => {
    const item: MemoItem = { id: "a", title: "A private task", body: "", kind: "task", status: "open", priority: "normal", repeatRule: "none", listId: null, dueDate: null, reminderAt: null, tags: [], pinned: false, archived: false, deletedAt: null, createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z" };
    setStorageAccount("alice"); saveItems([item]); saveLastSync("alice-sync");
    setStorageAccount("bob"); expect(loadItems()).toEqual([]); expect(loadLastSync()).toBeNull();
    setStorageAccount(null); expect(loadItems()).toEqual([]);
    setStorageAccount("alice"); expect(loadItems()[0].title).toBe("A private task"); expect(loadLastSync()).toBe("alice-sync");
  });
});
