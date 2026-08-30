import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrl = vi.hoisted(() => vi.fn());

vi.mock("obsidian", () => ({ requestUrl }));

import { buildOpenAiMessages, fetchEmbeddingModels } from "./localLlmProvider";
import type { LocalLlmConfig, Message } from "../types";

const config: LocalLlmConfig = {
  framework: "ollama",
  baseUrl: "http://localhost:11434",
  apiKey: "",
  model: "",
};

describe("fetchEmbeddingModels", () => {
  beforeEach(() => {
    requestUrl.mockReset();
  });

  it("includes Ollama embedding models identified by name as well as family", async () => {
    requestUrl.mockResolvedValue({
      json: {
        models: [
          { name: "nomic-embed-text:latest", details: { families: ["nomic-bert"] } },
          { name: "qwen3-embedding:8b-q8_0", details: { families: ["qwen3"] } },
          { name: "qwen3:8b", details: { families: ["qwen3"] } },
        ],
      },
    });

    await expect(fetchEmbeddingModels(config)).resolves.toEqual([
      "nomic-embed-text:latest",
      "qwen3-embedding:8b-q8_0",
    ]);
  });

  it("removes a trailing slash from the Ollama embedding server URL", async () => {
    requestUrl.mockResolvedValue({ json: { models: [] } });

    await fetchEmbeddingModels(config, "http://localhost:11434/");

    expect(requestUrl).toHaveBeenCalledWith({
      url: "http://localhost:11434/api/tags",
      method: "GET",
    });
  });
});

describe("buildOpenAiMessages", () => {
  it("forwards a PDF returned by a tool as an OpenAI file input", () => {
    const messages: Message[] = [{
      role: "tool",
      content: "PDF attached: report.pdf",
      timestamp: 1,
      toolCallId: "call_pdf",
      toolName: "read_note",
      attachments: [{ name: "report.pdf", type: "pdf", mimeType: "application/pdf", data: "JVBERg==" }],
    }];

    expect(buildOpenAiMessages(messages, "system")).toEqual([
      { role: "system", content: "system" },
      { role: "tool", content: "PDF attached: report.pdf", tool_call_id: "call_pdf" },
      {
        role: "user",
        content: [{
          type: "file",
          file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERg==" },
        }],
      },
    ]);
  });

  it("keeps every parallel tool result before the PDF user input", () => {
    const messages: Message[] = [
      { role: "tool", content: "PDF attached", timestamp: 1, toolCallId: "pdf", attachments: [{ name: "a.pdf", type: "pdf", mimeType: "application/pdf", data: "AA==" }] },
      { role: "tool", content: "other result", timestamp: 2, toolCallId: "other" },
    ];
    const wire = buildOpenAiMessages(messages, "system");

    expect(wire.map(message => message.role)).toEqual(["system", "tool", "tool", "user"]);
  });

  it("re-attaches a PDF read in an earlier turn from the bundled tool results", () => {
    const messages: Message[] = [
      { role: "user", content: "Summarize report.pdf", timestamp: 1 },
      {
        role: "assistant",
        content: "It is a quarterly report.",
        timestamp: 2,
        toolCalls: [{ id: "call_pdf", name: "read_note", arguments: { path: "report.pdf" } }],
        toolResults: [{
          toolCallId: "call_pdf",
          result: "PDF attached: report.pdf",
          attachments: [{ name: "report.pdf", type: "pdf", mimeType: "application/pdf", data: "JVBERg==" }],
        }],
      },
      { role: "user", content: "What does page 2 say?", timestamp: 3 },
    ];

    const wire = buildOpenAiMessages(messages, "system");

    expect(wire.map(message => message.role)).toEqual([
      "system", "user", "assistant", "tool", "user", "assistant", "user",
    ]);
    expect(wire[4].content).toEqual([{
      type: "file",
      file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERg==" },
    }]);
  });

  it("sends the same PDF once when a turn reads it twice", () => {
    const attachment = { name: "report.pdf", type: "pdf" as const, mimeType: "application/pdf", data: "JVBERg==", sourcePath: "Docs/report.pdf" };
    const messages: Message[] = [
      { role: "tool", content: "PDF attached", timestamp: 1, toolCallId: "a", attachments: [attachment] },
      { role: "tool", content: "PDF attached", timestamp: 2, toolCallId: "b", attachments: [attachment] },
    ];

    const wire = buildOpenAiMessages(messages, "system");

    expect(wire.map(message => message.role)).toEqual(["system", "tool", "tool", "user"]);
    expect(wire[3].content).toHaveLength(1);
  });

  it("replays reasoning and uses null content for a tool-only assistant turn", () => {
    const messages: Message[] = [
      { role: "user", content: "Update the active note", timestamp: 1 },
      {
        role: "assistant",
        content: "",
        thinking: "I need to read the note first.",
        timestamp: 2,
        toolCalls: [{ id: "call_1", name: "get_active_note", arguments: {} }],
      },
      {
        role: "tool",
        content: "Path: note.md\n\nExisting content",
        timestamp: 3,
        toolCallId: "call_1",
        toolName: "get_active_note",
      },
    ];

    expect(buildOpenAiMessages(messages, "system prompt")).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "Update the active note" },
      {
        role: "assistant",
        content: null,
        reasoning_content: "I need to read the note first.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_active_note", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        content: "Path: note.md\n\nExisting content",
        tool_call_id: "call_1",
      },
    ]);
  });

  it("keeps text content when a reasoning turn also calls a tool", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "I will inspect the note.",
        thinking: "The active note is required.",
        timestamp: 1,
        toolCalls: [{ id: "call_2", name: "get_active_note", arguments: {} }],
      },
    ];

    expect(buildOpenAiMessages(messages, "system")[1]).toMatchObject({
      role: "assistant",
      content: "I will inspect the note.",
      reasoning_content: "The active note is required.",
    });
  });

  it("rehydrates bundled tool results from persisted assistant history", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "The note was updated.",
        timestamp: 1,
        toolCalls: [
          { id: "call_read", name: "get_active_note", arguments: {} },
          { id: "call_write", name: "update_note", arguments: { path: "note.md", content: "hello" } },
        ],
        toolResults: [
          { toolCallId: "call_read", result: "Path: note.md\n\nこんにちは" },
          { toolCallId: "call_write", result: { success: true } },
        ],
      },
      { role: "user", content: "Now add a heading", timestamp: 2 },
    ];

    expect(buildOpenAiMessages(messages, "system")).toEqual([
      { role: "system", content: "system" },
      {
        role: "assistant",
        content: null,
        reasoning_content: undefined,
        tool_calls: [
          {
            id: "call_read",
            type: "function",
            function: { name: "get_active_note", arguments: "{}" },
          },
          {
            id: "call_write",
            type: "function",
            function: { name: "update_note", arguments: JSON.stringify({ path: "note.md", content: "hello" }) },
          },
        ],
      },
      { role: "tool", content: "Path: note.md\n\nこんにちは", tool_call_id: "call_read" },
      { role: "tool", content: JSON.stringify({ success: true }), tool_call_id: "call_write" },
      { role: "assistant", content: "The note was updated." },
      { role: "user", content: "Now add a heading" },
    ]);
  });
});
