import { describe, expect, it } from "vitest";
import { isCaretOnFirstLine, isCaretOnLastLine } from "./chatUtils";

describe("chat input caret line helpers", () => {
  const value = "first\nsecond\nthird";

  it("detects whether the caret is on the first line", () => {
    expect(isCaretOnFirstLine(value, 3)).toBe(true);
    expect(isCaretOnFirstLine(value, 7)).toBe(false);
  });

  it("detects whether the caret is on the last line", () => {
    expect(isCaretOnLastLine(value, 8)).toBe(false);
    expect(isCaretOnLastLine(value, value.length)).toBe(true);
  });
});
