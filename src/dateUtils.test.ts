import { describe, expect, it } from "vitest";
import { toDateKey } from "./dateUtils";

describe("dateUtils", () => {
  it("keeps local date keys stable around midnight", () => {
    expect(toDateKey(new Date(2026, 1, 1, 0, 0, 0))).toBe("2026-02-01");
  });
});
