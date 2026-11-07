import { describe, expect, it } from "vitest";
import { addDays, toDateKey } from "./dateUtils";

describe("dateUtils", () => {
  it("moves calendar dates by exactly one day", () => {
    expect(addDays("2026-02-01", 1)).toBe("2026-02-02");
    expect(addDays("2026-02-01", -1)).toBe("2026-01-31");
  });

  it("keeps local date keys stable around midnight", () => {
    expect(toDateKey(new Date(2026, 1, 1, 0, 0, 0))).toBe("2026-02-01");
  });
});
