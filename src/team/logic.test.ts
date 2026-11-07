import { describe, expect, it } from "vitest";
import { keyMatters, availableTransitions } from "./logic";
import type { TeamTask } from "./types";
const task = (patch: Partial<TeamTask> = {}): TeamTask => ({ id: "t", workspace_id: "w", title: "事项", body: "", owner_id: "me", created_by: "creator", status: "in_progress", priority: "normal", due_date: null, follow_up_date: null, next_action: "", version: 1, source_record_id: null, created_at: "", updated_at: "", ...patch });
describe("key matters", () => {
  it("includes my due/followup/blocked and created review tasks, excludes completed or unrelated tasks", () => {
    const items = [task({ id: "due", due_date: "2026-11-05" }), task({ id: "follow", follow_up_date: "2026-11-06" }), task({ id: "blocked", status: "blocked" }), task({ id: "review", owner_id: "other", created_by: "me", status: "review" }), task({ id: "done", status: "done", due_date: "2026-11-01" }), task({ id: "other", owner_id: "other", due_date: "2026-11-01" })];
    expect(keyMatters(items, "me", "2026-11-06").map(x => x.id)).toEqual(["due", "follow", "blocked", "review"]);
  });
});
describe("visible workflow actions", () => {
  it("offers acceptance only to creator/admin and work submission only to owner/admin", () => {
    expect(availableTransitions(task({ status: "review" }), "me", "member")).toEqual([]);
    expect(availableTransitions(task({ status: "review" }), "creator", "member")).toEqual(["done", "in_progress"]);
    expect(availableTransitions(task(), "me", "member")).toEqual(["review", "blocked"]);
    expect(availableTransitions(task(), "stranger", "member")).toEqual([]);
  });
});
