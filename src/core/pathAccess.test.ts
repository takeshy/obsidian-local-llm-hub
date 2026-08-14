import { describe, expect, it } from "vitest";
import { isUnsafePath } from "./pathAccess";

describe("isUnsafePath", () => {
  it("accepts nested vault-relative paths", () => {
    expect(isUnsafePath("plugin/data")).toBe(false);
  });

  it.each(["/tmp/data", "C:\\data", "../data", "data/../other", "./data"])(
    "rejects unsafe path %s",
    (path) => {
      expect(isUnsafePath(path)).toBe(true);
    },
  );
});
