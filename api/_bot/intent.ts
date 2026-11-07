import { parseTaskInput } from "./taskInputParser.js";
import type { RepeatRule } from "./types.js";

export type BotIntent =
  | { type: "bind"; code: string }
  | { type: "listToday" }
  | { type: "listOpen" }
  | { type: "complete"; query: string }
  | { type: "completeRecent" }
  | { type: "delete"; query: string }
  | { type: "deleteAllTasks" }
  | { type: "snooze"; minutes: number }
  | { type: "ack" }
  | {
      type: "createTask";
      title: string;
      dueDate: string | null;
      reminderAt: string | null;
      eventAt: string | null;
      endAt: string | null;
      repeatRule: RepeatRule;
      raw: string;
    }
  | {
      type: "createTasks";
      items: Array<Extract<BotIntent, { type: "createTask" }>>;
      raw: string;
    }
  | { type: "createNote"; title: string; body: string; raw: string }
  | { type: "unknown"; raw: string };

type EarlyReminderOffset = {
  matchedText: string;
  minutes: number;
};

type RepeatParseResult = {
  text: string;
  repeatRule: RepeatRule;
};

export function parseBotIntent(rawText: string, baseDate = new Date()): BotIntent {
  const text = normalizeText(rawText);
  if (!text) return { type: "unknown", raw: rawText };

  const bind = text.match(/^(?:绑定|bind)\s+([a-z]{2,8}-?\d{4,10})$/i);
  if (bind) return { type: "bind", code: bind[1].toUpperCase() };

  if (isTodayListQuery(text)) return { type: "listToday" };
  if (isOpenListQuery(text)) return { type: "listOpen" };

  if (/^(?:完成|完成了|搞定|搞定了|done)$/i.test(text)) return { type: "completeRecent" };

  const complete = text.match(/^(?:完成|搞定|done)\s*(.+)$/i);
  if (complete?.[1]?.trim()) return { type: "complete", query: complete[1].trim() };

  if (isDeleteAllTasksCommand(text)) return { type: "deleteAllTasks" };

  const remove = text.match(/^(?:删除|取消|delete)\s*(.+)$/i);
  if (remove?.[1]?.trim()) return { type: "delete", query: remove[1].trim() };

  const snooze = text.match(/^(?:稍后|snooze)\s*(\d{1,3})\s*(?:分钟|分|min|minutes?)?(?:提醒)?$/i);
  if (snooze) return { type: "snooze", minutes: clampMinutes(Number(snooze[1])) };

  if (/^(?:好|好的|收到|ok|嗯|恩)$/i.test(text)) return { type: "ack" };

  const note = parseNoteIntent(text, rawText);
  if (note) return note;

  const batch = parseBatchTaskIntent(text, baseDate, rawText);
  if (batch) return batch;

  const single = parseSingleTaskIntent(text, baseDate, rawText);
  if (single) return single;

  return { type: "unknown", raw: rawText };
}

function parseSingleTaskIntent(
  text: string,
  baseDate: Date,
  rawText: string,
  options: { requireSchedule?: boolean } = {}
): Extract<BotIntent, { type: "createTask" }> | null {
  const repeat = parseRepeatRule(text);
  const offset = parseEarlyOffset(text);
  const taskText = cleanupTaskText(offset ? repeat.text.replace(offset.matchedText, "") : repeat.text);
  const parsed = parseTaskInput(taskText, baseDate);
  const title = cleanupTaskTitle(parsed.title);
  if (!title) return null;
  if (options.requireSchedule && !parsed.dueDate && !parsed.reminderAt && repeat.repeatRule === "none") return null;

  const eventAt = parsed.reminderAt;
  const reminderAt =
    eventAt && offset ? new Date(new Date(eventAt).getTime() - offset.minutes * 60_000).toISOString() : parsed.reminderAt;

  return {
    type: "createTask",
    title,
    dueDate: parsed.dueDate,
    reminderAt,
    eventAt,
    endAt: parsed.endAt ?? null,
    repeatRule: repeat.repeatRule,
    raw: rawText,
  };
}

function parseBatchTaskIntent(text: string, baseDate: Date, rawText: string): Extract<BotIntent, { type: "createTasks" }> | null {
  const parts = text
    .split(/[，,、；;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const items = parts
    .map((part) => parseSingleTaskIntent(part, baseDate, part, { requireSchedule: true }))
    .filter((item): item is Extract<BotIntent, { type: "createTask" }> => Boolean(item));
  if (items.length < 2) return null;
  return { type: "createTasks", items, raw: rawText };
}

function parseNoteIntent(text: string, rawText: string): Extract<BotIntent, { type: "createNote" }> | null {
  const match = text.match(/^(?:记录一下|记一下|帮我记一下|帮我记录|记录|记下)\s*[，,、:：]?\s*(.+)$/i);
  const body = match?.[1]?.trim();
  if (!body) return null;

  const weight = body.match(/(?:今天|今日)?\s*体重\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)?/i);
  const title = weight ? `体重 ${weight[1]}kg` : body;
  return { type: "createNote", title, body, raw: rawText };
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isTodayListQuery(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (/^(?:今天有什么.*|今天.*任务|今日任务)$/i.test(compact)) return true;
  if (!/(?:今天|今日)/.test(compact)) return false;
  return /(?:有什么|有啥|哪些|还要做什么|要做什么|还剩什么|剩下什么|待办|任务|没完成|未完成|没做)/.test(compact);
}

function isOpenListQuery(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (/^(?:任务列表|人物列表|未完成任务|待办列表|list|tasks)$/i.test(compact)) return true;
  return /(?:还有|有什么|有啥|哪些|还剩|剩下)/.test(compact) && /(?:没完成|未完成|待办|任务|没做|要做)/.test(compact);
}

function isDeleteAllTasksCommand(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return /^(?:清理|清空|删除|取消)(?:全部|所有|全部的|所有的)?(?:任务|待办)$/.test(compact);
}

function parseRepeatRule(text: string): RepeatParseResult {
  if (/(?:每周|每星期|每礼拜)/.test(text)) {
    return {
      repeatRule: "weekly",
      text: text
        .replace(/每周([一二三四五六日天1-7])/g, "周$1")
        .replace(/每星期([一二三四五六日天1-7])/g, "星期$1")
        .replace(/每礼拜([一二三四五六日天1-7])/g, "礼拜$1")
        .replace(/(?:循环|重复)/g, ""),
    };
  }
  if (/(?:每天|每日)/.test(text)) {
    return {
      repeatRule: "daily",
      text: text.replace(/(?:每天|每日)/g, "今天").replace(/(?:循环|重复)/g, ""),
    };
  }
  if (/(?:每月|每个月)/.test(text)) {
    return {
      repeatRule: "monthly",
      text: text.replace(/(?:每月|每个月)/g, "").replace(/(?:循环|重复)/g, ""),
    };
  }
  return { repeatRule: "none", text: text.replace(/(?:循环|重复)$/g, "") };
}

function parseEarlyOffset(text: string): EarlyReminderOffset | null {
  const match = text.match(/[，,、\s]*(?:提前|early)\s*(\d{1,3})\s*(分钟|分|小时|个小时|min|minutes?|hours?)\s*(?:提醒|叫我|喊我|通知我|reminder)?/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const minutes = unit.includes("小时") || unit.startsWith("hour") ? amount * 60 : amount;
  return { matchedText: match[0], minutes: clampMinutes(minutes) };
}

function cleanupTaskText(value: string): string {
  return value.replace(/[，,、\s]+$/g, "").trim();
}

function cleanupTaskTitle(value: string): string {
  return value
    .replace(/^[\s的]+/g, "")
    .replace(/^(?:提醒我|叫我|喊我|通知我|帮我|记得)\s*/g, "")
    .replace(/\s*(?:提醒我|叫我|喊我|通知我|循环|重复)$/g, "")
    .trim();
}

function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(1440, Math.max(1, Math.round(value)));
}
