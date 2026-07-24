import { describe, expect, it } from "vitest";
import { filterModelOptions } from "./ModelSelector";

describe("filterModelOptions", () => {
  const models = ["qwen3:8b", "llama3.1:latest", "Qwen2.5-Coder", "qwen3:8b"];

  it("filters model names case-insensitively while preserving server order", () => {
    expect(filterModelOptions(models, "QWEN")).toEqual(["qwen3:8b", "Qwen2.5-Coder"]);
  });

  it("returns unique models when the query is empty", () => {
    expect(filterModelOptions(models, "  ")).toEqual(["qwen3:8b", "llama3.1:latest", "Qwen2.5-Coder"]);
  });
});
