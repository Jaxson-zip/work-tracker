import type { MemoItem } from "./types";

export function findBestOpenTaskMatch(items: MemoItem[], query: string): MemoItem | null {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return null;

  const candidates = sortOpenTasksForBot(items).filter((item) => {
    return item.kind === "task" && item.status === "open" && !item.archived && !item.deletedAt;
  });

  const exact = candidates.find((item) => normalizeText(item.title) === normalizedQuery);
  if (exact) return exact;

  return candidates.find((item) => normalizeText(item.title).includes(normalizedQuery)) ?? null;
}

export function sortOpenTasksForBot(items: MemoItem[]): MemoItem[] {
  return [...items]
    .filter((item) => item.kind === "task" && item.status === "open" && !item.archived && !item.deletedAt)
    .sort((a, b) => {
      const aTime = sortTime(a);
      const bTime = sortTime(b);
      if (aTime !== bTime) return aTime - bTime;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
}

function sortTime(item: MemoItem): number {
  const value = item.reminderAt ?? (item.dueDate ? `${item.dueDate}T23:59:59` : null);
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}
