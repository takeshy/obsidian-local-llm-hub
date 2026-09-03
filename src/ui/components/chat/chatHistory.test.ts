import { describe, expect, it } from "vitest";
import type { Message } from "src/types";
import { messagesToMarkdown, parseMarkdownToMessages } from "./chatHistory";

describe("chat history tool metadata", () => {
  it("preserves read_note path and PDF page range", () => {
    const message: Message = {
      role: "assistant",
      content: "Answer",
      timestamp: 1_700_000_000_000,
      toolCalls: [{
        id: "call-1",
        name: "read_note",
        arguments: { path: "resource/Introduction to Agents.pdf", startPage: 42, endPage: 43 },
      }],
    };

    const markdown = messagesToMarkdown([message], "Test", message.timestamp);
    const parsed = parseMarkdownToMessages(markdown);

    expect(parsed?.messages[0].toolCalls?.[0]).toEqual({
      id: "history-0",
      name: "read_note",
      arguments: { path: "resource/Introduction to Agents.pdf", startPage: 42, endPage: 43 },
    });
  });

  it("continues to restore legacy toolCallNames metadata", () => {
    const markdown = `---
title: "Legacy"
createdAt: 1700000000000
---

# Legacy

## **Assistant** (12:00:00)

Answer

<!-- msg-meta:{"toolCallNames":["read_note"],"timestamp":1700000000000} -->

---
`;

    const parsed = parseMarkdownToMessages(markdown);

    expect(parsed?.messages[0].toolCalls?.[0]).toEqual({
      id: "",
      name: "read_note",
      arguments: {},
    });
  });
});
