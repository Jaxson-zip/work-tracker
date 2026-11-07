import type { MemoItem } from "./types";
import type { BotIntent } from "./intent";

type CreateTaskIntent = Extract<BotIntent, { type: "createTask" }>;

export function formatCreatedTaskReply(
  item: Pick<MemoItem, "title" | "dueDate" | "reminderAt" | "repeatRule">,
  intent?: CreateTaskIntent
): string {
  if (!item.reminderAt && !item.dueDate) return `好，已记录：${item.title}`;
  return `好，${formatScheduledSummary(item, intent)}。到点我会提醒你。`;
}

export function formatCreatedTasksReply(
  entries: Array<{ item: Pick<MemoItem, "title" | "dueDate" | "reminderAt" | "repeatRule">; intent: CreateTaskIntent }>
): string {
  const sorted = [...entries].sort((a, b) => sortTime(a.item) - sortTime(b.item));
  return [`收到，已经帮你排好：`, ...sorted.map(({ item, intent }) => formatScheduledSummary(item, intent)), "到点我会提醒你。"].join("\n");
}

export function formatCreatedNoteReply(item: Pick<MemoItem, "title">): string {
  return `好，已记下：${item.title}。`;
}

export function formatTaskListReply(items: MemoItem[], emptyText: string): string {
  if (items.length === 0) return emptyText;
  return items.map((item, index) => `${index + 1}. ${formatTaskLine(item)}`).join("\n");
}

export function formatTaskLine(item: MemoItem): string {
  const when = item.reminderAt ? formatDateTime(item.reminderAt) : item.dueDate ?? "无日期";
  return `${when} ${item.title}`;
}

export function formatCompletedReply(item: Pick<MemoItem, "title">): string {
  return `已完成：${item.title}`;
}

export function formatDeletedReply(item: Pick<MemoItem, "title">): string {
  return `已删除：${item.title}`;
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatScheduledSummary(
  item: Pick<MemoItem, "title" | "dueDate" | "reminderAt" | "repeatRule">,
  intent?: CreateTaskIntent
): string {
  const when = intent?.eventAt ?? item.reminderAt ?? item.dueDate;
  const parts = [formatDateRange(when, intent?.endAt), item.title];
  const early = intent ? formatEarlyOffset(intent) : "";
  if (early) parts.push(`${early}叫你`);
  const repeat = formatRepeat(item.repeatRule);
  if (repeat) parts.push(repeat);
  return parts.join(" · ");
}

function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return "无日期";
  if (!end) return formatDateTime(start);
  const startText = formatDateTime(start);
  const endText = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(end));
  return `${startText}-${endText}`;
}

function formatEarlyOffset(intent: CreateTaskIntent): string {
  if (!intent.eventAt || !intent.reminderAt || intent.eventAt === intent.reminderAt) return "";
  const minutes = Math.max(1, Math.round((new Date(intent.eventAt).getTime() - new Date(intent.reminderAt).getTime()) / 60_000));
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes % 60 === 0) return `提前${minutes / 60}小时`;
  return `提前${minutes}分钟`;
}

function formatRepeat(rule: MemoItem["repeatRule"]): string {
  if (rule === "daily") return "每天";
  if (rule === "weekly") return "每周";
  if (rule === "monthly") return "每月";
  return "";
}

function sortTime(item: Pick<MemoItem, "dueDate" | "reminderAt">): number {
  const value = item.reminderAt ?? (item.dueDate ? `${item.dueDate}T23:59:59` : null);
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}
