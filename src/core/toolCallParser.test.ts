import { describe, it, expect } from "vitest";
import { extractInlineToolCalls } from "./toolCallParser";
import type { ToolDefinition } from "../types";

const tool = (name: string): ToolDefinition => ({
  type: "function",
  function: {
    name,
    description: `${name} tool`,
    parameters: { type: "object", properties: {}, required: [] },
  },
});

describe("extractInlineToolCalls", () => {
  it("returns no tool calls when text is empty", () => {
    const result = extractInlineToolCalls("", [tool("read_note")]);
    expect(result.toolCalls).toEqual([]);
    expect(result.cleanedText).toBe("");
  });

  it("returns no tool calls when no tools are provided", () => {
    const result = extractInlineToolCalls('{"name":"read_note","arguments":{}}', []);
    expect(result.toolCalls).toEqual([]);
  });

  it("detects Llama 3.1 style { function, arguments } bare JSON (issue #9)", () => {
    const text = `You can use the mcp__ms365_get_shared_mailbox_message function to get your most recent email. Here's an example of how you can do it:

{
  "function": "mcp__ms365_get_shared_mailbox_message",
  "arguments": {
    "userId": "me@example.com",
    "$limit": 1,
    "$orderby": "receivedDateTime DESC"
  }
}

This is telling the function to get only one message.`;
    const result = extractInlineToolCalls(text, [tool("mcp__ms365_get_shared_mailbox_message")]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("mcp__ms365_get_shared_mailbox_message");
    expect(result.toolCalls[0].args).toEqual({
      userId: "me@example.com",
      $limit: 1,
      $orderby: "receivedDateTime DESC",
    });
    expect(result.cleanedText).not.toContain('"function"');
  });

  it("detects <tool_call> wrapped JSON (Qwen format)", () => {
    const text = `Sure, let me read it.
<tool_call>
{"name": "read_note", "arguments": {"path": "notes/foo.md"}}
</tool_call>`;
    const result = extractInlineToolCalls(text, [tool("read_note")]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("read_note");
    expect(result.toolCalls[0].args).toEqual({ path: "notes/foo.md" });
    expect(result.cleanedText).not.toContain("<tool_call>");
  });

  it("detects [TOOL_CALLS] array (Mistral format)", () => {
    const text = `[TOOL_CALLS][{"name":"search_notes","arguments":{"query":"foo"}}]`;
    const result = extractInlineToolCalls(text, [tool("search_notes")]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("search_notes");
    expect(result.toolCalls[0].args).toEqual({ query: "foo" });
  });

  it("detects <|python_tag|> wrapped JSON (Llama 3.1 native format)", () => {
    const text = `<|python_tag|>{"name": "get_active_note", "parameters": {}}<|eom_id|>`;
    const result = extractInlineToolCalls(text, [tool("get_active_note")]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("get_active_note");
  });

  it("detects fenced ```json code blocks", () => {
    const text = `I'll call:
\`\`\`json
{"name": "list_notes", "arguments": {"folder": "notes"}}
\`\`\`
Let's see.`;
    const result = extractInlineToolCalls(text, [tool("list_notes")]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("list_notes");
    expect(result.toolCalls[0].args).toEqual({ folder: "notes" });
  });

  it("ignores JSON objects that don't reference a known tool", () => {
    const text = `Here is some data: {"name":"not_a_tool","arguments":{"x":1}} plus some text.`;
    const result = extractInlineToolCalls(text, [tool("read_note")]);
    expect(result.toolCalls).toEqual([]);
    expect(result.cleanedText).toBe(text.trim());
  });

  it("handles string-encoded arguments", () => {
    const text = `{"name":"read_note","arguments":"{\\"path\\":\\"foo.md\\"}"}`;
    const result = extractInlineToolCalls(text, [tool("read_note")]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].args).toEqual({ path: "foo.md" });
  });

  it("handles nested OpenAI-style { function: { name, arguments } }", () => {
    const text = `{"type":"function","function":{"name":"read_note","arguments":{"path":"x.md"}}}`;
    const result = extractInlineToolCalls(text, [tool("read_note")]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("read_note");
    expect(result.toolCalls[0].args).toEqual({ path: "x.md" });
  });

  it("extracts multiple bare tool calls from one message", () => {
    const text = `First: {"name":"read_note","arguments":{"path":"a.md"}}
Then: {"name":"read_note","arguments":{"path":"b.md"}}`;
    const result = extractInlineToolCalls(text, [tool("read_note")]);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map((t) => t.args)).toEqual([
      { path: "a.md" },
      { path: "b.md" },
    ]);
  });

  it("is not confused by braces inside string literals", () => {
    const text = `Reading: {"name":"read_note","arguments":{"path":"a {b} c.md"}}`;
    const result = extractInlineToolCalls(text, [tool("read_note")]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].args).toEqual({ path: "a {b} c.md" });
  });
});
