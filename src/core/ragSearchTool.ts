import type { ToolDefinition } from "../types";
import type { RagSearchResult } from "./ragStore";

export const RAG_SEARCH_TOOL_NAME = "rag_search";
export const MAX_RAG_SEARCHES_PER_TURN = 3;
export const MAX_DYNAMIC_RAG_RESULTS = 3;

export const RAG_SEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: RAG_SEARCH_TOOL_NAME,
    description: "Search the selected RAG index with a focused semantic query. Use this when the automatically retrieved context is missing, too broad, or suggests a better follow-up query. Searches only the configured RAG index; it does not scan the vault directly.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Focused semantic search query. Rephrase or narrow the user's request instead of repeating it unchanged.",
        },
      },
      required: ["query"],
    },
  },
};

export function formatRagSearchToolResult(
  query: string,
  results: RagSearchResult[],
  remainingSearches: number,
): string {
  return JSON.stringify({
    query,
    results: results.map((result) => ({
      filePath: result.filePath,
      ...(result.heading ? { heading: result.heading } : {}),
      ...(result.pageLabel ? { pageLabel: result.pageLabel } : {}),
      score: result.score,
      text: result.text,
    })),
    remainingSearches,
  });
}
