export type ItemKind = "task" | "note";
export type ItemStatus = "open" | "done" | "purged";
export type Priority = "low" | "normal" | "high";
export type RepeatRule = "none" | "daily" | "weekly" | "monthly";

export interface MemoItem {
  id: string;
  listId: string | null;
  title: string;
  body: string;
  kind: ItemKind;
  status: ItemStatus;
  priority: Priority;
  repeatRule: RepeatRule;
  dueDate: string | null;
  reminderAt: string | null;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
