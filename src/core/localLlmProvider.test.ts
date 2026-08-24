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
