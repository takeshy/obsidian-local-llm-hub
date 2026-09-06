/**
 * Fallback parser for tool calls embedded in model text output.
 *
 * Small local models (e.g. llama3.1:8b, mistral 7b) sometimes emit tool
 * invocations as JSON inside their normal text content instead of using the
 * structured `tool_calls` response field. When that happens the host client
 * would otherwise see only a description of the tool call and never actually
 * execute it. This parser recognises the common formats produced by these
 * models and converts them back into `ToolCall` objects so the caller can
 * still dispatch them.
 *
 * Supported formats:
 *   - `<tool_call>{"name":"...","arguments":{...}}</tool_call>` (Qwen)
 *   - `[TOOL_CALLS][{"name":"...","arguments":{...}}]` (Mistral)
 *   - `<|python_tag|>{"name":"...","parameters":{...}}<|eom_id|>` (Llama 3.1)
 *   - ```json { "function": "name", "arguments": {...} } ``` (fenced)
 *   - Bare JSON object with a known tool name in the text
 */

import type { ToolCall, ToolDefinition } from "../types";

interface RawCall {
  name?: unknown;
  function?: unknown;
  tool?: unknown;
  arguments?: unknown;
  parameters?: unknown;
  args?: unknown;
}

export interface InlineToolCallResult {
  toolCalls: ToolCall[];
  /** Text with recognised tool-call blocks stripped out. */
  cleanedText: string;
}

/**
 * Scan `text` for tool-call payloads that match one of the tools in `tools`.
 * Returns the extracted ToolCall objects plus the text with those blocks
 * removed. If nothing recognisable is found, `toolCalls` is empty and
 * `cleanedText` equals the input.
 */
export function extractInlineToolCalls(
  text: string,
  tools: ToolDefinition[],
): InlineToolCallResult {
  if (!text || tools.length === 0) {
    return { toolCalls: [], cleanedText: text };
  }
  const toolNames = new Set(tools.map((t) => t.function.name));
  const toolCalls: ToolCall[] = [];
  let working = text;

  // 1. <tool_call>...</tool_call> (Qwen and similar)
  working = working.replace(
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi,
    (match, body: string) => {
      const parsed = tryParseCallJson(body, toolNames);
      if (parsed.length > 0) {
        toolCalls.push(...parsed);
        return "";
      }
      return match;
    },
  );

  // 2. [TOOL_CALLS] [...] (Mistral)
  working = working.replace(
    /\[TOOL_CALLS\]\s*(\[[\s\S]*?\])/g,
    (match, body: string) => {
      const parsed = tryParseCallJson(body, toolNames);
      if (parsed.length > 0) {
        toolCalls.push(...parsed);
        return "";
      }
      return match;
    },
  );

  // 3. <|python_tag|>...<|eom_id|> (Llama 3.1 native format)
  working = working.replace(
    /<\|python_tag\|>\s*([\s\S]*?)\s*<\|(?:eom_id|eot_id)\|>/g,
    (match, body: string) => {
      const parsed = tryParseCallJson(body, toolNames);
      if (parsed.length > 0) {
        toolCalls.push(...parsed);
        return "";
      }
      return match;
    },
  );

  // 4. Fenced code blocks ```json ... ``` (or plain ``` ... ```)
  working = working.replace(
    /```(?:json|tool_call|toolcall)?\s*\n?([\s\S]*?)\n?\s*```/g,
    (match, body: string) => {
      const parsed = tryParseCallJson(body, toolNames);
      if (parsed.length > 0) {
        toolCalls.push(...parsed);
        return "";
      }
      return match;
    },
  );

  // 5. Bare balanced JSON objects anywhere in the remaining text
  if (toolCalls.length === 0) {
    const bare = extractBareJsonToolCalls(working, toolNames);
    if (bare.toolCalls.length > 0) {
      toolCalls.push(...bare.toolCalls);
      working = bare.cleanedText;
    }
  }

  return { toolCalls, cleanedText: working.trim() };
}

/** Try to parse a JSON string that may encode one or more tool calls. */
function tryParseCallJson(body: string, toolNames: Set<string>): ToolCall[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => normalizeToolCall(item, toolNames))
      .filter((x): x is ToolCall => x !== null);
  }
  const single = normalizeToolCall(parsed, toolNames);
  return single ? [single] : [];
}

/** Coerce a raw object into a `ToolCall`, returning null if it doesn't map to a known tool. */
function normalizeToolCall(raw: unknown, toolNames: Set<string>): ToolCall | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as RawCall;

  // The OpenAI / Ollama canonical shape: { function: { name, arguments } }
  if (obj.function && typeof obj.function === "object") {
    const inner = obj.function as RawCall;
    const nested = normalizeToolCall(
      {
        name: inner.name,
        arguments: inner.arguments ?? inner.parameters ?? inner.args,
        parameters: inner.parameters,
      },
      toolNames,
    );
    if (nested) return nested;
  }

  const nameCandidate = obj.name ?? obj.function ?? obj.tool;
  if (typeof nameCandidate !== "string" || !nameCandidate) return null;
  if (!toolNames.has(nameCandidate)) return null;

  const argsCandidate = obj.arguments ?? obj.parameters ?? obj.args ?? {};
  let args: Record<string, unknown>;
  if (typeof argsCandidate === "string") {
    args = parseJsonObject(argsCandidate);
  } else if (argsCandidate && typeof argsCandidate === "object" && !Array.isArray(argsCandidate)) {
    args = argsCandidate as Record<string, unknown>;
  } else {
    args = {};
  }

  return {
    id: `call_inline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: nameCandidate,
    args,
  };
}

function parseJsonObject(s: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

/**
 * Walk the text looking for balanced JSON objects, parse each, and keep the
 * ones that reference a known tool. Handles strings/escapes so braces inside
 * string literals don't confuse the bracket counter.
 */
function extractBareJsonToolCalls(
  text: string,
  toolNames: Set<string>,
): InlineToolCallResult {
  const toolCalls: ToolCall[] = [];
  const pieces: string[] = [];
  let cursor = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] !== "{") {
      i++;
      continue;
    }
    const end = findJsonObjectEnd(text, i);
    if (end === -1) {
      i++;
      continue;
    }
    const candidate = text.slice(i, end + 1);
    const parsed = tryParseCallJson(candidate, toolNames);
    if (parsed.length > 0) {
      toolCalls.push(...parsed);
      pieces.push(text.slice(cursor, i));
      cursor = end + 1;
      i = end + 1;
    } else {
      i = end + 1;
    }
  }
  pieces.push(text.slice(cursor));
  return { toolCalls, cleanedText: pieces.join("") };
}

/** Return the index of the matching `}` for the `{` at position `start`, or -1. */
function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
