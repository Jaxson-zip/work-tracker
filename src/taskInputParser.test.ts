import { describe, expect, it } from "vitest";
import { parseTaskInput } from "./taskInputParser";

const baseDate = new Date("2026-04-23T09:00:00+08:00");

function localHourMinute(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

describe("parseTaskInput", () => {
  it("parses dot separated evening time without eating the title", () => {
    const parsed = parseTaskInput("晚上5.30体育馆打球", baseDate, { rollPastTime: false });

    expect(parsed.title).toBe("体育馆打球");
    expect(localHourMinute(parsed.reminderAt)).toBe("17:30");
  });

  it("tolerates an extra connector after evening", () => {
    const parsed = parseTaskInput("晚上上5.30体育馆打球", baseDate, { rollPastTime: false });

    expect(parsed.title).toBe("体育馆打球");
    expect(localHourMinute(parsed.reminderAt)).toBe("17:30");
  });

  it("keeps existing colon and half-hour inputs working", () => {
    expect(localHourMinute(parseTaskInput("晚上8:15聚餐", baseDate, { rollPastTime: false }).reminderAt)).toBe("20:15");
    expect(localHourMinute(parseTaskInput("晚上8点半聚餐", baseDate, { rollPastTime: false }).reminderAt)).toBe("20:30");
  });

  it("parses short morning and evening words", () => {
    const morning = parseTaskInput("周五早9点的高铁", baseDate, { rollPastTime: false });
    const evening = parseTaskInput("周二晚8点私教课", baseDate, { rollPastTime: false });

    expect(morning.title).toBe("的高铁");
    expect(localHourMinute(morning.reminderAt)).toBe("09:00");
    expect(evening.title).toBe("私教课");
    expect(localHourMinute(evening.reminderAt)).toBe("20:00");
  });

  it("treats a dangling dot after an hour as o'clock", () => {
    const plainHour = parseTaskInput("8.上班", baseDate, { rollPastTime: false });
    const eveningHour = parseTaskInput("晚上8.上班", baseDate, { rollPastTime: false });

    expect(plainHour.title).toBe("上班");
    expect(localHourMinute(plainHour.reminderAt)).toBe("08:00");
    expect(eveningHour.title).toBe("上班");
    expect(localHourMinute(eveningHour.reminderAt)).toBe("20:00");
  });

  it("parses common Chinese time ranges without keeping the end time in the title", () => {
    const cases = [
      "明天下午5.到7.打球",
      "明天下午5到7打球",
      "明天下午5点到7点打球",
      "明天下午5-7打球",
      "明天下午5:30到7:30打球",
      "明天晚上8到9点打球",
    ];

    const parsed = cases.map((value) => parseTaskInput(value, baseDate, { rollPastTime: false }));

    expect(parsed.map((item) => item.title)).toEqual(["打球", "打球", "打球", "打球", "打球", "打球"]);
    expect(parsed.map((item) => localHourMinute(item.reminderAt))).toEqual([
      "17:00",
      "17:00",
      "17:00",
      "17:00",
      "17:30",
      "20:00",
    ]);
    expect(parsed.map((item) => localHourMinute(item.endAt ?? null))).toEqual([
      "19:00",
      "19:00",
      "19:00",
      "19:00",
      "19:30",
      "21:00",
    ]);
  });

  it("still parses clear hour inputs for work tasks", () => {
    const plainTime = parseTaskInput("8.30上班", baseDate, { rollPastTime: false });
    const morningTime = parseTaskInput("上午8上班", baseDate, { rollPastTime: false });
    const pointTime = parseTaskInput("上午8点上班", baseDate, { rollPastTime: false });

    expect(plainTime.title).toBe("上班");
    expect(localHourMinute(plainTime.reminderAt)).toBe("08:30");
    expect(morningTime.title).toBe("上班");
    expect(localHourMinute(morningTime.reminderAt)).toBe("08:00");
    expect(pointTime.title).toBe("上班");
    expect(localHourMinute(pointTime.reminderAt)).toBe("08:00");
  });
});
