export type ItemKind = "task" | "note";
export type ItemStatus = "open" | "done" | "purged";
export type Priority = "low" | "normal" | "high";
export type RepeatRule = "none" | "daily" | "weekly" | "monthly";
export type ViewFilter = "inbox" | "today" | "upcoming" | "pinned" | "notes" | "done" | "archive";

export interface MemoList {
  id: string;
  name: string;
  emoji: string;
  archived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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

export interface DraftItem {
  title: string;
  body: string;
  kind: ItemKind;
  priority: Priority;
  repeatRule: RepeatRule;
  dueDate: string | null;
  reminderAt: string | null;
  tags: string;
  listId: string | null;
}

export interface SyncState {
  configured: boolean;
  signedIn: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  message: string;
  error: string | null;
}
