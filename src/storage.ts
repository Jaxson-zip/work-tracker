import type { MemoItem, MemoList } from "./types";

const ITEMS_KEY = "todo-memo.items.v1";
const LISTS_KEY = "todo-memo.lists.v1";
const LAST_SYNC_KEY = "todo-memo.last-sync.v1";
const FOCUS_SETTINGS_KEY = "todo-memo.focus-settings.v1";
const APP_SETTINGS_KEY = "todo-memo.app-settings.v1";

export type FocusSettings = {
  focusMinutes: number;
  breakMinutes: number;
};

export type AppSettings = {
  defaultListId: string | null;
};

export function loadItems(): MemoItem[] {
  const raw = localStorage.getItem(ITEMS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeMemoItem).filter((item): item is MemoItem => Boolean(item));
  } catch {
    return [];
  }
}

export function saveItems(items: MemoItem[]): void {
  localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
}

export function loadLists(): MemoList[] {
  const raw = localStorage.getItem(LISTS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeMemoList).filter((list): list is MemoList => Boolean(list));
  } catch {
    return [];
  }
}

export function saveLists(lists: MemoList[]): void {
  localStorage.setItem(LISTS_KEY, JSON.stringify(lists));
}

export function loadLastSync(): string | null {
  return localStorage.getItem(LAST_SYNC_KEY);
}

export function saveLastSync(value: string): void {
  localStorage.setItem(LAST_SYNC_KEY, value);
}

export function loadFocusSettings(): FocusSettings {
  const fallback = { focusMinutes: 25, breakMinutes: 5 };
  const raw = localStorage.getItem(FOCUS_SETTINGS_KEY);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<FocusSettings>;
    return {
      focusMinutes: normalizeTimerMinutes(parsed.focusMinutes, fallback.focusMinutes),
      breakMinutes: normalizeTimerMinutes(parsed.breakMinutes, fallback.breakMinutes),
    };
  } catch {
    return fallback;
  }
}

export function saveFocusSettings(settings: FocusSettings): void {
  localStorage.setItem(FOCUS_SETTINGS_KEY, JSON.stringify(settings));
}

export function loadAppSettings(): AppSettings {
  const fallback: AppSettings = { defaultListId: null };
  const raw = localStorage.getItem(APP_SETTINGS_KEY);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      defaultListId: typeof parsed.defaultListId === "string" ? parsed.defaultListId : null,
    };
  } catch {
    return fallback;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
}

export function createId(): string {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function normalizeMemoItem(value: unknown): MemoItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<MemoItem>;
  const valid =
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.body === "string" &&
    (item.kind === "task" || item.kind === "note") &&
    (item.status === "open" || item.status === "done" || item.status === "purged") &&
    (item.priority === "low" || item.priority === "normal" || item.priority === "high") &&
    Array.isArray(item.tags) &&
    typeof item.pinned === "boolean" &&
    typeof item.archived === "boolean" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string";

  if (!valid) return null;
  const memo = item as MemoItem;

  return {
    id: memo.id,
    listId: typeof item.listId === "string" ? item.listId : null,
    title: memo.title,
    body: memo.body,
    kind: memo.kind,
    status: memo.status,
    priority: memo.priority,
    repeatRule:
      item.repeatRule === "daily" || item.repeatRule === "weekly" || item.repeatRule === "monthly"
        ? item.repeatRule
        : "none",
    dueDate: typeof item.dueDate === "string" ? item.dueDate : null,
    reminderAt: typeof item.reminderAt === "string" ? item.reminderAt : null,
    tags: memo.tags,
    pinned: memo.pinned,
    archived: memo.archived,
    deletedAt: typeof item.deletedAt === "string" ? item.deletedAt : null,
    createdAt: memo.createdAt,
    updatedAt: memo.updatedAt,
  };
}

function normalizeMemoList(value: unknown): MemoList | null {
  if (!value || typeof value !== "object") return null;
  const list = value as Partial<MemoList>;
  if (
    typeof list.id !== "string" ||
    typeof list.name !== "string" ||
    typeof list.emoji !== "string" ||
    typeof list.archived !== "boolean" ||
    typeof list.createdAt !== "string" ||
    typeof list.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: list.id,
    name: list.name,
    emoji: list.emoji,
    archived: list.archived,
    deletedAt: typeof list.deletedAt === "string" ? list.deletedAt : null,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}

function normalizeTimerMinutes(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(180, Math.max(1, Math.round(value)));
}
