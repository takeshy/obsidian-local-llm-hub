/**
 * Local LLM Provider
 * Connects to local LLM servers via OpenAI-compatible API
 * Supports: Ollama, LM Studio, llama.cpp, vLLM, LocalAI, etc.
 *
 * Uses Obsidian's requestUrl for non-streaming requests (bypasses CORS)
 * and Node.js http/https for streaming (bypasses CORS).
 *
 * Ollama uses native /api/chat for streaming (immediate response, real-time thinking).
 * Other frameworks use /v1/chat/completions (OpenAI-compatible SSE).
 */

import { requestUrl } from "obsidian";
import type { Message, StreamChunk, LocalLlmConfig, ToolDefinition } from "../types";
import type { OllamaRequestWriter } from "./ollamaRequestCapture";
import {
  runLocalLlmChat,
  fetchChatModels as fetchChatModelsShared,
  fetchEmbeddingModels as fetchEmbeddingModelsShared,
  buildLocalLlmRequest,
  buildOllamaMessages,
  streamLocalLlmLines,
  getStreamIdleTimeoutMs,
  LocalLlmResponseParser,
  extractInlineToolCalls,
  formatError,
} from "obsidian-llm-hub-common/core";

export type LocalLlmStreamChunk = StreamChunk & { finishReason?: string };

const versionChecks = new Set<string>();
let requestSequence = 0;

/** Best effort only: version discovery must never hold up generation. */
function logOllamaVersion(config: LocalLlmConfig): void {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  if (versionChecks.has(baseUrl)) return;
  versionChecks.add(baseUrl);
  void requestUrl({
    url: `${baseUrl}/api/version`,
    method: "GET",
    ...(config.apiKey ? { headers: { Authorization: `Bearer ${config.apiKey}` } } : {}),
  }).then(response => {
    const data: unknown = response.json;
    const version = data && typeof data === "object" && "version" in data && typeof data.version === "string"
      ? data.version : "unknown";
    console.debug("[llm-hub] Ollama server", { version });
  }).catch(() => {
    console.debug("[llm-hub] Ollama server", { version: "unavailable" });
  });
}

const getModelList = async (url: string, headers: Record<string, string>): Promise<unknown> =>
  (await requestUrl({ url, method: "GET", ...(Object.keys(headers).length > 0 ? { headers } : {}) })).json;

/**
 * Verify connection to local LLM server and check available models
 */
export async function verifyLocalLlm(config: LocalLlmConfig): Promise<{
  success: boolean;
  error?: string;
  models?: string[];
}> {
  try {
    return { success: true, models: await fetchChatModels(config) };
  } catch {
    return { success: false, error: `Cannot connect to ${config.baseUrl}. Is the server running?` };
  }
}

/**
 * Fetch available models from the local LLM server
 */
export async function fetchLocalLlmModels(config: LocalLlmConfig): Promise<string[]> {
  const result = await verifyLocalLlm(config);
  return result.models || [];
}

function fetchChatModels(config: LocalLlmConfig): Promise<string[]> {
  return fetchChatModelsShared(
    { baseUrl: config.baseUrl, apiKey: config.apiKey, framework: config.framework },
    getModelList,
  );
}

/**
 * Fetch available embedding models. A separate embedding server is addressed as
 * a plain OpenAI-compatible one: the framework describes the chat server.
 */
export async function fetchEmbeddingModels(config: LocalLlmConfig, embeddingBaseUrl?: string): Promise<string[]> {
  try {
    return await fetchEmbeddingModelsShared({
      baseUrl: embeddingBaseUrl || config.baseUrl,
      apiKey: config.apiKey,
      framework: embeddingBaseUrl ? undefined : config.framework,
    }, getModelList);
  } catch {
    return [];
  }
}

/**
 * Stream chat completion from a local LLM server.
 * Ollama: uses native /api/chat (NDJSON, immediate streaming).
 * LM Studio / AnythingLLM: uses OpenAI-compatible chat/completions (SSE).
 */
export async function* localLlmChatStream(
  config: LocalLlmConfig,
  messages: Message[],
  systemPrompt: string,
  signal?: AbortSignal,
  tools?: ToolDefinition[],
  writeRequest?: OllamaRequestWriter,
): AsyncGenerator<LocalLlmStreamChunk> {
  if (config.framework !== "ollama") {
    yield* runLocalLlmChat({ config, messages, systemPrompt, signal, tools });
    return;
  }
  if (signal?.aborted) return;
  logOllamaVersion(config);
  const requestId = `${Date.now()}-${++requestSequence}`;
  const startedAt = Date.now();
  // Keep the shared request builder, parser and transport. The host retains the
  // native terminal reason, which the shared parser currently discards.
  try {
    const request = buildLocalLlmRequest({ config, messages, systemPrompt, tools });
    if (config.captureOllamaRequests && writeRequest) {
      try {
        await writeRequest({ requestId, body: request.body });
      } catch {
        console.warn("[llm-hub] Ollama request capture failed", { requestId });
      }
    }
    if (signal?.aborted) return;
    const wireMessages = buildOllamaMessages(messages, systemPrompt);
    const toolResults = wireMessages.filter(message => message.role === "tool");
    console.debug("[llm-hub] Ollama request", {
      requestId,
      model: config.model,
      continuation: messages.at(-1)?.role === "tool",
      maxTokens: config.maxTokens ?? "server default",
      messageCount: wireMessages.length,
      availableToolCount: tools?.length ?? 0,
      toolCallCount: wireMessages.reduce((count, message) => count + (message.tool_calls?.length ?? 0), 0),
      toolResults: toolResults.map(message => ({
        hasToolName: Boolean(message.tool_name),
        contentChars: message.content.length,
      })),
    });
    const parser = new LocalLlmResponseParser("ollama");
    let text = "";
    let thinkingChars = 0;
    let toolCallCount = 0;
    let finishReason: string | undefined;
    let terminalReceived = false;
    const activeTools = tools?.map(tool => tool.function.name) ?? [];
    const emit = function* (chunks: StreamChunk[]): Generator<LocalLlmStreamChunk> {
      for (const chunk of chunks) {
        if (chunk.type === "text") text += chunk.content ?? "";
        if (chunk.type === "thinking") thinkingChars += chunk.content?.length ?? 0;
        if (chunk.type === "tool_call") toolCallCount++;
        if (chunk.type === "done") {
          if (!toolCallCount && activeTools.length && text.trim()) {
            const fallback = extractInlineToolCalls(text, activeTools);
            if (fallback.toolCalls.length) {
              text = fallback.cleanedText;
              yield { type: "replace_text", content: text };
              for (const toolCall of fallback.toolCalls) {
                toolCallCount++;
                yield { type: "tool_call", toolCall };
              }
            }
          }
          console.debug("[llm-hub] Ollama response", {
            requestId, elapsedMs: Date.now() - startedAt,
            model: config.model, finishReason: finishReason ?? "unknown", terminalReceived,
            textChars: text.length, thinkingChars, toolCallCount, usage: chunk.usage,
          });
          yield { ...chunk, finishReason };
        } else yield chunk;
      }
    };
    let firstLineReceived = false;
    for await (const line of streamLocalLlmLines({
      ...request, signal, idleTimeoutMs: getStreamIdleTimeoutMs(config),
    })) {
      if (!firstLineReceived) {
        firstLineReceived = true;
        console.debug("[llm-hub] Ollama first response line", { requestId, elapsedMs: Date.now() - startedAt });
      }
      if (parser.done) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (value && typeof value === "object" && "done" in value && value.done === true) {
          terminalReceived = true;
          if ("done_reason" in value && typeof value.done_reason === "string") finishReason = value.done_reason;
        }
      } catch { /* The shared parser handles non-JSON lines. */ }
      yield* emit(parser.push(line));
    }
    // Drain the HTTP response before the caller begins its next tool round.
    if (!signal?.aborted) yield* emit(parser.finish());
  } catch (error) {
    if (!signal?.aborted) {
      const message = formatError(error);
      console.warn("[llm-hub] Ollama request failed", {
        requestId, elapsedMs: Date.now() - startedAt, model: config.model, error: message,
      });
      yield { type: "error", error: message };
    }
  }
}
