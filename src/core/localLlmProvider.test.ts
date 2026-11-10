import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestUrl = vi.hoisted(() => vi.fn());
const streamLines = vi.hoisted(() => vi.fn());
const sharedChat = vi.hoisted(() => vi.fn());

vi.mock("obsidian", () => ({ requestUrl }));
vi.mock("obsidian-llm-hub-common/core", async importOriginal => ({
  ...await importOriginal<typeof import("obsidian-llm-hub-common/core")>(),
  streamLocalLlmLines: streamLines,
  runLocalLlmChat: sharedChat,
}));

import { fetchEmbeddingModels, localLlmChatStream } from "./localLlmProvider";
import type { LocalLlmConfig, Message, ToolDefinition } from "../types";
import type { OllamaRequestWriter } from "./ollamaRequestCapture";

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

describe("Ollama continuation diagnostics", () => {
  const tools: ToolDefinition[] = [{
    type: "function",
    function: { name: "crossref_search_journals", description: "Search journals", parameters: { type: "object", properties: {} } },
  }];
  const messages: Message[] = [
    { role: "user", content: "private query", timestamp: 0 },
    { role: "assistant", content: "", thinking: "private reasoning", timestamp: 1,
      toolCalls: [{ id: "call1", name: "crossref_search_journals", args: { query: "Nutrients" } }] },
    { role: "tool", content: "private journal metadata", toolCallId: "call1", toolName: "crossref_search_journals", timestamp: 2 },
  ];
  const chatConfig = { ...config, model: "qwen3:8b", maxTokens: 100, apiKey: "private-api-key" };
  const collect = async (overrides: Partial<LocalLlmConfig> = {}, signal?: AbortSignal, writer?: OllamaRequestWriter) => {
    const chunks = [];
    for await (const chunk of localLlmChatStream({ ...chatConfig, ...overrides }, messages, "private system prompt", signal, tools, writer)) chunks.push(chunk);
    return chunks;
  };
  function respond(...values: unknown[]) {
    streamLines.mockImplementation(async function* () {
      for (const value of values) yield typeof value === "string" ? value : JSON.stringify(value);
    });
  }

  beforeEach(() => {
    streamLines.mockReset();
    sharedChat.mockReset();
    requestUrl.mockReset().mockResolvedValue({ json: { version: "0.12.0" } });
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends the complete tool exchange and logs only diagnostic metadata", async () => {
    respond({ message: { content: "Nutrients is published by MDPI AG." }, done: true, done_reason: "stop", eval_count: 12 });
    const chunks = await collect();
    const request = streamLines.mock.calls[0][0];
    const body = JSON.parse(request.body);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(body.messages[2]).toMatchObject({ thinking: "private reasoning", tool_calls: [{ function: { arguments: { query: "Nutrients" } } }] });
    expect(body.messages[3]).toMatchObject({ tool_name: "crossref_search_journals", content: "private journal metadata" });
    expect(chunks.at(-1)).toMatchObject({ type: "done", finishReason: "stop", usage: { outputTokens: 12 } });
    expect(console.debug).toHaveBeenCalledWith("[llm-hub] Ollama request", expect.objectContaining({
      continuation: true, maxTokens: 100, toolCallCount: 1,
      toolResults: [{ hasToolName: true, contentChars: messages[2].content.length }],
    }));
    expect(console.debug).toHaveBeenCalledWith("[llm-hub] Ollama server", { version: "0.12.0" });
    expect(JSON.stringify(vi.mocked(console.debug).mock.calls)).not.toMatch(/private|Nutrients|MDPI/);
  });

  it("preserves a token limit reason when all output is thinking", async () => {
    respond(
      { message: { thinking: "private reasoning" }, done: false },
      { message: { content: "" }, done: true, done_reason: "length", eval_count: 100 },
    );
    const chunks = await collect();
    expect(chunks.filter(chunk => chunk.type === "text")).toHaveLength(0);
    expect(chunks.at(-1)).toMatchObject({ type: "done", finishReason: "length" });
    expect(console.debug).toHaveBeenCalledWith("[llm-hub] Ollama response", expect.objectContaining({
      finishReason: "length", terminalReceived: true, textChars: 0, thinkingChars: 17, toolCallCount: 0,
    }));
  });

  it("keeps inline tool-call recovery and reports the recovered call", async () => {
    respond({ message: { content: '{"name":"crossref_search_journals","arguments":{"query":"Nutrients"}}' }, done: true, done_reason: "stop" });
    const chunks = await collect();
    expect(chunks).toContainEqual(expect.objectContaining({ type: "tool_call", toolCall: expect.objectContaining({ name: "crossref_search_journals", args: { query: "Nutrients" } }) }));
    expect(chunks).toContainEqual({ type: "replace_text", content: "" });
    expect(console.debug).toHaveBeenCalledWith("[llm-hub] Ollama response", expect.objectContaining({ toolCallCount: 1 }));
  });

  it("drains the response even after receiving the terminal event", async () => {
    let drained = false;
    streamLines.mockImplementation(async function* () {
      yield JSON.stringify({ message: { content: "Answer" }, done: true, done_reason: "stop" });
      yield "ignored trailer";
      drained = true;
    });
    const chunks = await collect();
    expect(drained).toBe(true);
    expect(chunks.filter(chunk => chunk.type === "done")).toHaveLength(1);
  });

  it("reports a missing terminal event without inventing a stop reason", async () => {
    respond("invalid JSON", { message: { content: "partial answer" } });
    const chunks = await collect();
    expect(chunks.at(-1)).toMatchObject({ type: "done", finishReason: undefined });
    expect(console.debug).toHaveBeenCalledWith("[llm-hub] Ollama response", expect.objectContaining({ terminalReceived: false, finishReason: "unknown" }));
  });

  it("does not let version discovery failure interrupt generation", async () => {
    requestUrl.mockRejectedValue(new Error("version unavailable"));
    respond({ message: { content: "Answer" }, done: true, done_reason: "stop" });
    const chunks = await collect({ baseUrl: "http://other-server:11434/" });
    expect(chunks.at(-1)).toMatchObject({ type: "done", finishReason: "stop" });
    expect(console.debug).toHaveBeenCalledWith("[llm-hub] Ollama server", { version: "unavailable" });
  });

  it("propagates transport failures as error chunks", async () => {
    streamLines.mockImplementation(async function* () { throw new Error("socket hang up"); });
    expect(await collect()).toEqual([{ type: "error", error: "socket hang up" }]);
  });

  it("records timeout diagnostics even when no response line arrives", async () => {
    const error = "Stream timed out: no data received for 120 seconds";
    streamLines.mockImplementation(async function* () { throw new Error(error); });

    expect(await collect()).toEqual([{ type: "error", error }]);
    expect(console.warn).toHaveBeenCalledWith("[llm-hub] Ollama request failed", expect.objectContaining({
      requestId: expect.any(String), elapsedMs: expect.any(Number), model: chatConfig.model, error,
    }));
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private");
    expect(streamLines.mock.calls[0][0].idleTimeoutMs).toBe(120000);
  });

  it("uses the configured idle timeout for a slow local model", async () => {
    respond({ message: { content: "Answer" }, done: true, done_reason: "stop" });
    await collect({ streamIdleTimeoutSeconds: 600 });
    expect(streamLines.mock.calls[0][0].idleTimeoutMs).toBe(600000);
  });

  it("does not send an already cancelled request", async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await collect({}, abort.signal)).toEqual([]);
    expect(streamLines).not.toHaveBeenCalled();
  });

  it("keeps other backends on the shared provider", async () => {
    sharedChat.mockImplementation(async function* () { yield { type: "done" }; });
    expect(await collect({ framework: "lm-studio" })).toEqual([{ type: "done" }]);
    expect(sharedChat).toHaveBeenCalledOnce();
    expect(streamLines).not.toHaveBeenCalled();
  });

  it("does not capture request contents unless explicitly enabled", async () => {
    const writer = vi.fn();
    respond({ message: { content: "Answer" }, done: true });
    await collect({}, undefined, writer);
    expect(writer).not.toHaveBeenCalled();
  });

  it("captures the exact body before transport, without connection credentials", async () => {
    const writer = vi.fn().mockResolvedValue(undefined);
    streamLines.mockImplementation(async function* () {
      expect(writer).toHaveBeenCalledOnce();
      yield JSON.stringify({ message: { content: "Answer" }, done: true });
    });
    await collect({ captureOllamaRequests: true }, undefined, writer);
    const capture = writer.mock.calls[0][0];
    expect(capture.body).toBe(streamLines.mock.calls[0][0].body);
    expect(capture.body).toContain("private system prompt");
    expect(capture.body).toContain("private journal metadata");
    expect(JSON.stringify(capture)).not.toContain("private-api-key");
    expect(console.debug).toHaveBeenCalledWith("[llm-hub] Ollama request", expect.objectContaining({ requestId: capture.requestId }));
    expect(console.debug).toHaveBeenCalledWith("[llm-hub] Ollama first response line", expect.objectContaining({ requestId: capture.requestId, elapsedMs: expect.any(Number) }));
    expect(console.debug).toHaveBeenCalledWith("[llm-hub] Ollama response", expect.objectContaining({ requestId: capture.requestId, elapsedMs: expect.any(Number) }));
    expect(JSON.stringify(vi.mocked(console.debug).mock.calls)).not.toContain("private");
  });

  it("continues generation if capture fails without logging sensitive errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    respond({ message: { content: "Answer" }, done: true });
    const writer = vi.fn().mockRejectedValue(new Error("private file content"));
    expect((await collect({ captureOllamaRequests: true }, undefined, writer)).at(-1)).toMatchObject({ type: "done" });
    expect(warn).toHaveBeenCalledWith("[llm-hub] Ollama request capture failed", { requestId: expect.any(String) });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
  });

  it("uses a different capture file identifier for each round", async () => {
    const writer = vi.fn().mockResolvedValue(undefined);
    respond({ done: true });
    await collect({ captureOllamaRequests: true }, undefined, writer);
    await collect({ captureOllamaRequests: true }, undefined, writer);
    expect(writer.mock.calls[0][0].requestId).not.toBe(writer.mock.calls[1][0].requestId);
  });
});
