import { describe, expect, it } from "vitest";
import { errorText } from "./client";

describe("错误提示", () => {
  it("数据库的英文错误转成中文，不认识的不原样露出", () => {
    expect(errorText("Version conflict")).toContain("别人刚改过");
    expect(errorText("Reassign open tasks before removing member")).toContain("交给别人");
    expect(errorText("some internal detail")).toBe("操作失败，请稍后再试");
  });
});
