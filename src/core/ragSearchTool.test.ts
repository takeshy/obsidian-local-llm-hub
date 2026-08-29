import { describe, expect, it } from "vitest";
import {
  MAX_DYNAMIC_RAG_RESULTS,
  MAX_RAG_SEARCHES_PER_TURN,
  RAG_SEARCH_TOOL,
  formatRagSearchToolResult,
} from "./ragSearchTool";

describe("RAG search tool", () => {
  it("requires a focused query and exposes stable limits", () => {
    expect(RAG_SEARCH_TOOL.function.name).toBe("rag_search");
    expect(RAG_SEARCH_TOOL.function.parameters.required).toEqual(["query"]);
    expect(MAX_RAG_SEARCHES_PER_TURN).toBe(3);
    expect(MAX_DYNAMIC_RAG_RESULTS).toBe(3);
  });

  it("formats source metadata and remaining budget", () => {
    const formatted = JSON.parse(formatRagSearchToolResult("product overview", [{
      filePath: "spec/product.md",
      text: "Product details",
      score: 0.82,
      heading: "Overview",
      startOffset: 10,
    }], 1)) as Record<string, unknown>;

    expect(formatted).toEqual({
      query: "product overview",
      results: [{
        filePath: "spec/product.md",
        heading: "Overview",
        score: 0.82,
        text: "Product details",
      }],
      remainingSearches: 1,
    });
  });
});
