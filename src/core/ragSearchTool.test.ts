import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import {
  RAG_SEARCH_TOOL,
  RAG_SEARCH_TOOL_NAME,
  compactRagSearchToolResult,
  formatRagSearchToolResult,
  mergeRagCitations,
  trimRagSearchHistory,
} from "./ragSearchTool";

describe("RAG search tool", () => {
  it("requires a focused query", () => {
    expect(RAG_SEARCH_TOOL.function.name).toBe("rag_search");
    expect(RAG_SEARCH_TOOL.function.parameters.required).toEqual(["query"]);
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

  it("drops chunks already cited by an earlier search in the same turn", () => {
    const auto = [
      { filePath: "spec/product.md", startOffset: 0 },
      { filePath: "spec/product.md", startOffset: 900 },
    ];
    const refined = [
      { filePath: "spec/product.md", startOffset: 900 },
      { filePath: "spec/limits.md", startOffset: 40 },
    ];

    expect(mergeRagCitations(auto, refined)).toEqual([
      { filePath: "spec/product.md", startOffset: 0 },
      { filePath: "spec/product.md", startOffset: 900 },
      { filePath: "spec/limits.md", startOffset: 40 },
    ]);
  });

  it("treats the same offset in different files as distinct citations", () => {
    expect(mergeRagCitations(undefined, [
      { filePath: "a.md", startOffset: 0 },
      { filePath: "b.md", startOffset: 0 },
    ])).toHaveLength(2);
  });

  it("keeps source metadata when compacting an earlier result", () => {
    const compacted = JSON.parse(compactRagSearchToolResult(formatRagSearchToolResult(
      "product overview",
      [{ filePath: "spec/product.md", text: "Product details", score: 0.82, startOffset: 10 }],
      1,
    ))) as { results: Record<string, unknown>[]; query: string; note: string };

    expect(compacted.query).toBe("product overview");
    expect(compacted.results).toEqual([{ filePath: "spec/product.md", score: 0.82 }]);
    expect(compacted.note).toMatch(/omitted/);
  });

  it("leaves a non-json tool result untouched", () => {
    expect(compactRagSearchToolResult("RAG search failed: boom")).toBe("RAG search failed: boom");
  });

  it("keeps the most recent rag_search turn verbatim and compacts older ones", () => {
    const ragTurn = (id: string, text: string): Message => ({
      role: "assistant",
      content: "",
      timestamp: 0,
      toolCalls: [{ id, name: RAG_SEARCH_TOOL_NAME, arguments: { query: "q" } }],
      toolResults: [{
        toolCallId: id,
        result: formatRagSearchToolResult("q", [{ filePath: "a.md", text, score: 0.5, startOffset: 0 }], 1),
      }],
    });
    const messages: Message[] = [
      ragTurn("call-1", "oldest body"),
      { role: "user", content: "next", timestamp: 0 },
      ragTurn("call-2", "newest body"),
    ];

    const trimmed = trimRagSearchHistory(messages);

    expect(trimmed[0].toolResults![0].result).not.toContain("oldest body");
    expect(trimmed[2].toolResults![0].result).toContain("newest body");
    // The stored history itself must not be mutated; only the replay is reduced.
    expect(messages[0].toolResults![0].result).toContain("oldest body");
    expect(trimmed[1]).toBe(messages[1]);
  });

  it("leaves non-rag tool results in an older turn alone", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        timestamp: 0,
        toolCalls: [
          { id: "rag", name: RAG_SEARCH_TOOL_NAME, arguments: { query: "q" } },
          { id: "note", name: "read_note", arguments: { path: "a.md" } },
        ],
        toolResults: [
          { toolCallId: "rag", result: formatRagSearchToolResult("q", [{ filePath: "a.md", text: "chunk body", score: 0.5, startOffset: 0 }], 1) },
          { toolCallId: "note", result: "full note body" },
        ],
      },
      {
        role: "assistant",
        content: "",
        timestamp: 0,
        toolCalls: [{ id: "rag2", name: RAG_SEARCH_TOOL_NAME, arguments: { query: "q2" } }],
        toolResults: [{ toolCallId: "rag2", result: formatRagSearchToolResult("q2", [], 0) }],
      },
    ];

    const trimmed = trimRagSearchHistory(messages);

    expect(trimmed[0].toolResults![0].result).not.toContain("chunk body");
    expect(trimmed[0].toolResults![1].result).toBe("full note body");
  });

  it("returns the original array when nothing is stale", () => {
    const messages: Message[] = [{ role: "user", content: "hi", timestamp: 0 }];
    expect(trimRagSearchHistory(messages)).toBe(messages);
  });
});
