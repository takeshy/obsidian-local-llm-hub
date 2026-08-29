import type { Message, RagCitation, ToolDefinition } from "../types";
import type { RagSearchResult } from "./ragStore";

export const RAG_SEARCH_TOOL_NAME = "rag_search";
export const MAX_RAG_SEARCHES_PER_TURN = 3;
export const MAX_DYNAMIC_RAG_RESULTS = 3;
/** How many earlier turns keep their rag_search chunk bodies in the replayed history. */
export const MAX_FULL_RAG_HISTORY_TURNS = 1;

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

/** Merge citations, dropping chunks already cited by an earlier search this turn. */
export function mergeRagCitations(
  existing: RagCitation[] | undefined,
  incoming: RagCitation[],
): RagCitation[] {
  const merged = [...(existing ?? [])];
  const seen = new Set(merged.map(citation => `${citation.filePath}|${citation.startOffset}`));
  for (const citation of incoming) {
    const key = `${citation.filePath}|${citation.startOffset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(citation);
  }
  return merged;
}

/** Strip chunk bodies from a stored rag_search result, keeping its citation metadata. */
export function compactRagSearchToolResult(result: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return result;
  }
  if (!parsed || typeof parsed !== "object") return result;
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.results)) return result;
  const results: unknown[] = record.results;

  return JSON.stringify({
    ...record,
    results: results.map(item =>
      item && typeof item === "object"
        ? Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([key]) => key !== "text"))
        : item),
    note: "Chunk bodies from this earlier search were omitted to keep the conversation short. Search again if the full text is needed.",
  });
}

/**
 * rag_search results stay in the replayed history for the rest of the chat, so a
 * long conversation would otherwise accumulate every chunk ever retrieved. Keep
 * the most recent turns verbatim and reduce older ones to their source metadata.
 */
export function trimRagSearchHistory(messages: Message[]): Message[] {
  const ragTurns: number[] = [];
  messages.forEach((message, index) => {
    if (message.toolResults?.length && message.toolCalls?.some(tc => tc.name === RAG_SEARCH_TOOL_NAME)) {
      ragTurns.push(index);
    }
  });
  if (ragTurns.length <= MAX_FULL_RAG_HISTORY_TURNS) return messages;

  const stale = new Set(ragTurns.slice(0, ragTurns.length - MAX_FULL_RAG_HISTORY_TURNS));
  return messages.map((message, index) => {
    if (!stale.has(index)) return message;
    const ragCallIds = new Set(
      message.toolCalls!.filter(tc => tc.name === RAG_SEARCH_TOOL_NAME).map(tc => tc.id),
    );
    return {
      ...message,
      toolResults: message.toolResults!.map(toolResult =>
        ragCallIds.has(toolResult.toolCallId) && typeof toolResult.result === "string"
          ? { ...toolResult, result: compactRagSearchToolResult(toolResult.result) }
          : toolResult),
    };
  });
}
