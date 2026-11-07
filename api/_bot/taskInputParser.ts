import * as chrono from "chrono-node";
import { getToday, toDateKey } from "./dateUtils.js";

export type ParsedTaskInput = {
  title: string;
  dueDate: string | null;
  reminderAt: string | null;
  endAt?: string | null;
};

export function parseTaskInput(
  rawTitle: string,
  baseDate = new Date(),
  options: { rollPastTime?: boolean } = {}
): ParsedTaskInput {
  const raw = rawTitle.trim();
  if (!raw) return { title: "", dueDate: null, reminderAt: null };

  const quick = parseChineseQuickTime(raw, baseDate, options.rollPastTime ?? true);
  if (quick) return quick;

  const results = chrono.zh.hans.casual.parse(raw, baseDate);
  const first = results[0];
  if (!first) return { title: raw, dueDate: null, reminderAt: null };
  if (!isClearlyTemporalResult(first.text)) return { title: raw, dueDate: null, reminderAt: null };

  const parsedDate = first.start.date();
  const title = cleanupParsedTitle(raw.slice(0, first.index) + raw.slice(first.index + first.text.length));
  const fallbackTitle = title || raw;

  return {
    title: fallbackTitle,
    dueDate: toDateKey(parsedDate),
    reminderAt: parsedDate.toISOString(),
  };
}

function parseChineseQuickTime(
  raw: string,
  baseDate: Date,
  rollPastTime: boolean
): ParsedTaskInput | null {
  const datePrefix =
    "(?:(今天|今晚|明天|明晚|后天|大后天|周[一二三四五六日天1-7]|星期[一二三四五六日天1-7]|礼拜[一二三四五六日天1-7])\\s*)?";
  const timePrefix = "(凌晨|早|早上|上午|中午|下午|晚|晚上|今晚|傍晚|夜里|明晚)?\\s*";
  const timeConnector = "(?:上|的|在)?\\s*";
  const timeCore = "(\\d{1,2})(?:(?:[:：.．](\\d{1,2}))|点半|点|半|(?:[:：.．](?=\\D|$)))?";
  const match = raw.match(new RegExp(`^\\s*${datePrefix}${timePrefix}${timeConnector}${timeCore}`));
  if (!match) return null;

  const [, dateWord, periodWord, hourText, minuteText] = match;
  const hasDateWord = Boolean(dateWord);
  const hasPeriodWord = Boolean(periodWord);
  const hasExplicitTimeMarker = /[:：.．点半]/.test(match[0]);
  if (!hasDateWord && !hasPeriodWord && !hasExplicitTimeMarker) return null;

  const hour = Number(hourText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;

  const minute = match[0].includes("半") ? 30 : minuteText ? Number(minuteText) : 0;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  const date = dateFromWord(dateWord || periodWord || "", baseDate);
  const normalizedStartHour = normalizeHour(hour, periodWord || dateWord || "");
  date.setHours(normalizedStartHour, minute, 0, 0);

  if (rollPastTime && !dateWord && toDateKey(baseDate) === getToday() && date.getTime() < Date.now() - 60_000) {
    date.setDate(date.getDate() + 1);
  }

  const range = parseTrailingTimeRange(raw.slice(match[0].length), date, periodWord || dateWord || "");
  const title = cleanupParsedTitle(raw.slice(match[0].length + range.consumedLength));
  return {
    title: title || raw,
    dueDate: toDateKey(date),
    reminderAt: date.toISOString(),
    endAt: range.endAt?.toISOString() ?? null,
  };
}

function parseTrailingTimeRange(
  value: string,
  startDate: Date,
  inheritedPeriod: string
): { consumedLength: number; endAt: Date | null } {
  const rangeConnector = "\\s*(?:到|至|[-~～—－])\\s*";
  const period = "(凌晨|早|早上|上午|中午|下午|晚|晚上|今晚|傍晚|夜里|明晚)?\\s*";
  const endCore = "(\\d{1,2})(?:(?:[:：.．](\\d{1,2}))|点半|点|半|(?:[:：.．](?=\\D|$)))?";
  const match = value.match(new RegExp(`^${rangeConnector}${period}${endCore}`));
  if (!match) return { consumedLength: 0, endAt: null };

  const [matched, endPeriod = "", hourText, minuteText] = match;
  const hour = Number(hourText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { consumedLength: 0, endAt: null };

  const minute = matched.includes("半") ? 30 : minuteText ? Number(minuteText) : 0;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return { consumedLength: 0, endAt: null };

  const endAt = new Date(startDate);
  endAt.setHours(normalizeHour(hour, endPeriod || inheritedPeriod), minute, 0, 0);
  if (endAt.getTime() <= startDate.getTime()) endAt.setDate(endAt.getDate() + 1);
  return { consumedLength: matched.length, endAt };
}

function isClearlyTemporalResult(text: string): boolean {
  return /(\d|今天|今晚|明天|明晚|后天|大后天|周[一二三四五六日天1-7]|星期[一二三四五六日天1-7]|礼拜[一二三四五六日天1-7]|凌晨|早上|上午|中午|下午|晚上|傍晚|夜里|点|半|号|月)/.test(
    text
  );
}

function dateFromWord(word: string, baseDate: Date): Date {
  const date = new Date(baseDate);
  date.setSeconds(0, 0);

  if (word === "明天" || word === "明晚") {
    date.setDate(date.getDate() + 1);
    return date;
  }
  if (word === "后天") {
    date.setDate(date.getDate() + 2);
    return date;
  }
  if (word === "大后天") {
    date.setDate(date.getDate() + 3);
    return date;
  }

  const weekMatch = word.match(/(?:周|星期|礼拜)([一二三四五六日天1-7])/);
  if (weekMatch) {
    const target = weekdayToNumber(weekMatch[1]);
    const current = date.getDay() === 0 ? 7 : date.getDay();
    const delta = (target - current + 7) % 7 || 7;
    date.setDate(date.getDate() + delta);
  }

  return date;
}

function weekdayToNumber(value: string): number {
  const map: Record<string, number> = {
    一: 1,
    "1": 1,
    二: 2,
    "2": 2,
    三: 3,
    "3": 3,
    四: 4,
    "4": 4,
    五: 5,
    "5": 5,
    六: 6,
    "6": 6,
    日: 7,
    天: 7,
    "7": 7,
  };
  return map[value] ?? 1;
}

function normalizeHour(hour: number, period: string): number {
  if (["下午", "晚", "晚上", "今晚", "傍晚", "夜里", "明晚"].includes(period) && hour < 12) return hour + 12;
  if (period === "中午" && hour < 11) return hour + 12;
  if (period === "凌晨" && hour === 12) return 0;
  return hour;
}

function cleanupParsedTitle(value: string): string {
  return value.replace(/^[\s,.，。:：;；、-]+/, "").trim();
}
