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
import type { Message, StreamChunk, LocalLlmConfig, ToolDefinition, ToolCall } from "../types";
import {
  buildOpenAiMessages,
  extractInlineToolCalls,
  fetchChatModels as fetchChatModelsShared,
  fetchEmbeddingModels as fetchEmbeddingModelsShared,
  openaiPathPrefix,
  formatStreamIdleTimeoutError,
  getHttpModule,
  getStreamIdleTimeoutMs,
  parseThinkTags,
  StreamSignal,
} from "obsidian-llm-hub-common/core";

// Ollama message format
interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: {
    type: "function";
    function: { name: string; arguments: Record<string, unknown> };
  }[];
  tool_name?: string;
}

interface OllamaStreamResponse {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: {
      function: { name: string; arguments: Record<string, unknown> };
    }[];
  };
  done?: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OpenAiStreamResponse {
  choices?: {
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string } | string;
  message?: string;
}

/** Ask the server through Obsidian, which is how a local port is reached without CORS. */
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
): AsyncGenerator<StreamChunk> {
  const activeTools = tools && tools.length > 0 ? tools : undefined;
  const inner = config.framework === "ollama"
    ? ollamaChatStream(config, messages, systemPrompt, signal, activeTools)
    : openaiChatStream(config, messages, systemPrompt, signal, activeTools);

  if (!activeTools) {
    yield* inner;
    return;
  }

  // Fallback: some small local models (e.g. llama3.1:8b, mistral 7b) emit
  // tool calls as JSON text in `content` instead of via the structured
  // `tool_calls` field. If the stream finishes without any native tool call
  // but the text looks like one, parse it and synthesize tool_call chunks so
  // the caller can still dispatch the tool. See issue #9.
  let accumulatedText = "";
  let sawNativeToolCall = false;

  for await (const chunk of inner) {
    if (chunk.type === "text" && chunk.content) {
      accumulatedText += chunk.content;
      yield chunk;
      continue;
    }
    if (chunk.type === "tool_call") {
      sawNativeToolCall = true;
      yield chunk;
      continue;
    }
    if (chunk.type === "done") {
      if (!sawNativeToolCall && accumulatedText.trim()) {
        const { toolCalls, cleanedText } = extractInlineToolCalls(accumulatedText, activeTools.map(tool => tool.function.name));
        if (toolCalls.length > 0) {
          // Tell the consumer to drop the raw JSON we already streamed; emit
          // this before the tool_call chunks so any UI that echoes the
          // accumulated text alongside the tool call sees the cleaned version.
          yield { type: "replace_text", content: cleanedText };
          for (const toolCall of toolCalls) {
            yield { type: "tool_call", toolCall };
          }
        }
      }
      yield chunk;
      continue;
    }
    yield chunk;
  }
}

/**
 * Stream via Ollama's native /api/chat endpoint (NDJSON format).
 * Starts streaming immediately, including during prompt evaluation.
 */
async function* ollamaChatStream(
  config: LocalLlmConfig,
  messages: Message[],
  systemPrompt: string,
  signal?: AbortSignal,
  tools?: ToolDefinition[],
): AsyncGenerator<StreamChunk> {
  const ollamaMessages: OllamaMessage[] = [
    { role: "system", content: systemPrompt },
  ];
  for (const msg of messages) {
    if (msg.role === "tool") {
      ollamaMessages.push({
        role: "tool",
        content: msg.content,
        tool_name: msg.toolName,
      });
    } else if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      ollamaMessages.push({
        role: "assistant",
        content: msg.content,
        tool_calls: msg.toolCalls.map(tc => ({
          type: "function" as const,
          function: { name: tc.name, arguments: tc.args },
        })),
      });
    } else {
      ollamaMessages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.llmContent ?? msg.content,
      });
    }
  }

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages: ollamaMessages,
    stream: true,
  };

  if (tools) {
    requestBody.tools = tools;
  }

  const options: Record<string, unknown> = {};
  if (config.temperature != null) options.temperature = config.temperature;
  if (config.maxTokens != null) options.num_predict = config.maxTokens;
  if (Object.keys(options).length > 0) requestBody.options = options;

  const body = JSON.stringify(requestBody);
  const url = new URL(`${config.baseUrl}/api/chat`);
  const httpModule = getHttpModule(url.protocol);

  const chunks: StreamChunk[] = [];
  const signal$ = new StreamSignal();
  let streamDone = false;
  let streamError: Error | null = null;

  let inThinkTag = false;
  let tagBuffer = "";
  let hasNativeThinking = false;

  const req = httpModule.request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        let errorBody = "";
        res.on("data", (chunk: Uint8Array) => { errorBody += chunk.toString(); });
        res.on("end", () => {
          chunks.push({ type: "error", error: `HTTP ${res.statusCode}: ${errorBody.slice(0, 200) || res.statusMessage}` });
          streamDone = true;
          signal$.notify();
        });
        return;
      }

      let buffer = "";
      let loggedFirst = false;

      res.on("data", (chunk: Uint8Array) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed) as unknown as OllamaStreamResponse;

            // Log first few chunks to debug format
            if (!loggedFirst) {
              console.debug("[llm-hub] Ollama first chunk:", trimmed.slice(0, 500));
              loggedFirst = true;
            }

            // Thinking via separate field (newer Ollama)
            if (parsed.message?.thinking) {
              hasNativeThinking = true;
              chunks.push({ type: "thinking", content: parsed.message.thinking });
            }

            // Tool calls (Ollama gives arguments as JSON object)
            if (parsed.message?.tool_calls) {
              for (const tc of parsed.message.tool_calls) {
                const toolCall: ToolCall = {
                  id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  name: tc.function.name,
                  args: tc.function.arguments,
                };
                chunks.push({ type: "tool_call", toolCall });
              }
            }

            // Parse content
            const content = parsed.message?.content;
            if (content) {
              if (hasNativeThinking) {
                // Native thinking handles the split; treat content as plain text
                chunks.push({ type: "text", content });
              } else {
                // Old Ollama: content may contain <think> tags
                const thinkParsed = parseThinkTags(content, inThinkTag, tagBuffer);
                inThinkTag = thinkParsed.inThinkTag;
                tagBuffer = thinkParsed.tagBuffer;
                for (const item of thinkParsed.items) {
                  chunks.push(item);
                }
              }
            }

            // Final message with done=true
            if (parsed.done) {
              // Flush any remaining tagBuffer
              if (tagBuffer) {
                chunks.push({ type: inThinkTag ? "thinking" : "text", content: tagBuffer });
                tagBuffer = "";
              }
              const usage = (parsed.prompt_eval_count || parsed.eval_count)
                ? {
                    inputTokens: parsed.prompt_eval_count,
                    outputTokens: parsed.eval_count,
                    totalTokens: (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0),
                  }
                : undefined;
              chunks.push({ type: "done", usage });
              streamDone = true;
              signal$.notify();
              return;
            }
          } catch (parseErr) {
            console.warn("[llm-hub] Failed to parse Ollama NDJSON:", trimmed.slice(0, 200), parseErr);
          }
        }
        signal$.notify();
      });

      res.on("end", () => {
        if (!streamDone) {
          if (tagBuffer) {
            chunks.push({ type: inThinkTag ? "thinking" : "text", content: tagBuffer });
            tagBuffer = "";
          }
          chunks.push({ type: "done" });
          streamDone = true;
        }
        signal$.notify();
      });

      res.on("error", (err: Error) => {
        streamError = err;
        signal$.notify();
      });
    },
  );

  req.on("error", (err: Error) => {
    streamError = err;
    streamDone = true;
    signal$.notify();
  });

  const onAbort = () => {
    req.destroy();
    streamDone = true;
    signal$.notify();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  req.write(body);
  req.end();

  try {
    while (!streamDone || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
        continue;
      }
      if (streamError !== null) {
        yield { type: "error", error: `Connection failed: ${(streamError as Error).message}` };
        return;
      }
      if (streamDone) break;
      if (signal?.aborted) return;
      const idleTimeoutMs = getStreamIdleTimeoutMs(config);
      const ok = await signal$.wait(idleTimeoutMs);
      if (!ok) {
        yield { type: "error", error: formatStreamIdleTimeoutError(idleTimeoutMs) };
        req.destroy();
        return;
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Stream via OpenAI-compatible /v1/chat/completions endpoint (SSE format).
 * Used for LM Studio and other OpenAI-compatible servers.
 */
async function* openaiChatStream(
  config: LocalLlmConfig,
  messages: Message[],
  systemPrompt: string,
  signal?: AbortSignal,
  tools?: ToolDefinition[],
): AsyncGenerator<StreamChunk> {
  const openaiMessages = buildOpenAiMessages(messages, systemPrompt);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages: openaiMessages,
    stream: true,
    ...(config.temperature != null && { temperature: config.temperature }),
    ...(config.maxTokens != null && { max_tokens: config.maxTokens }),
  };

  // AnythingLLM's OpenAI-compatible endpoint does not support the `tools` parameter.
  // Sending tools causes it to return an internal chat ID instead of LLM output.
  if (tools && config.framework !== "anythingllm") {
    requestBody.tools = tools;
  }
  const body = JSON.stringify(requestBody);
  // Node's http client otherwise sends request bodies with chunked transfer
  // encoding. Some OpenAI-compatible local servers intermittently fail to
  // consume a chunked tool-continuation request in full, so send the exact
  // UTF-8 byte length just like fetch-based clients do.
  headers["Content-Length"] = String(new TextEncoder().encode(body).byteLength);

  const url = new URL(`${config.baseUrl}${openaiPathPrefix(config.framework)}/chat/completions`);
  const httpModule = getHttpModule(url.protocol);

  const chunks: StreamChunk[] = [];
  const signal$ = new StreamSignal();
  let streamDone = false;
  let streamError: Error | null = null;

  const req = httpModule.request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers,
    },
    (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        let errorBody = "";
        res.on("data", (chunk: Uint8Array) => { errorBody += chunk.toString(); });
        res.on("end", () => {
          chunks.push({ type: "error", error: `HTTP ${res.statusCode}: ${errorBody.slice(0, 200) || res.statusMessage}` });
          streamDone = true;
          signal$.notify();
        });
        return;
      }

      let buffer = "";
      let inThinkTag = false;
      let tagBuffer = "";

      // Accumulate tool call arguments across SSE chunks
      const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();
      let emittedToolCall = false;

      res.on("data", (chunk: Uint8Array) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            // Emit any remaining accumulated tool calls
            for (const [, tc] of pendingToolCalls) {
              try {
                const args = JSON.parse(tc.args) as unknown as Record<string, unknown>;
                chunks.push({ type: "tool_call", toolCall: { id: tc.id, name: tc.name, args: args } });
              } catch {
                chunks.push({ type: "tool_call", toolCall: { id: tc.id, name: tc.name, args: {} } });
              }
            }
            pendingToolCalls.clear();
            if (tagBuffer) {
              chunks.push({ type: inThinkTag ? "thinking" : "text", content: tagBuffer });
              tagBuffer = "";
            }
            chunks.push({ type: "done" });
            streamDone = true;
            signal$.notify();
            return;
          }

          try {
            const parsed = JSON.parse(data) as unknown as OpenAiStreamResponse;

            // Some OpenAI-compatible servers (e.g. llama.cpp / LM Studio) report
            // runtime errors like context-length overflow as HTTP 200 with an
            // `error` field in the SSE payload. Surface those as error chunks.
            if (parsed.error) {
              const errMsg = typeof parsed.error === "string"
                ? parsed.error
                : parsed.error.message || parsed.message || "Unknown streaming error";
              chunks.push({ type: "error", error: errMsg });
              streamDone = true;
              signal$.notify();
              return;
            }

            const choice = parsed.choices?.[0];
            const delta = choice?.delta;

            if (delta?.reasoning_content) {
              chunks.push({ type: "thinking", content: delta.reasoning_content });
            }

            if (delta?.content) {
              const thinkParsed = parseThinkTags(delta.content, inThinkTag, tagBuffer);
              inThinkTag = thinkParsed.inThinkTag;
              tagBuffer = thinkParsed.tagBuffer;
              for (const item of thinkParsed.items) {
                chunks.push(item);
              }
            }

            // Accumulate tool call deltas
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const existing = pendingToolCalls.get(tc.index);
                if (existing) {
                  if (tc.function?.arguments) existing.args += tc.function.arguments;
                } else {
                  pendingToolCalls.set(tc.index, {
                    id: tc.id || `call_${Date.now()}_${tc.index}`,
                    name: tc.function?.name || "",
                    args: tc.function?.arguments || "",
                  });
                }
              }
            }

            // finish_reason: "tool_calls" (OpenAI) or "function_call" (legacy) means all tool calls are complete
            if (choice?.finish_reason === "tool_calls" || choice?.finish_reason === "function_call") {
              if (pendingToolCalls.size === 0 && !emittedToolCall) {
                // llama.cpp can intermittently report a tool-call finish while
                // omitting all tool-call deltas. Let the caller retry the same
                // round instead of silently treating it as an empty response.
                chunks.push({ type: "incomplete_tool_call" });
              }
              for (const [, tc] of pendingToolCalls) {
                try {
                  const args = JSON.parse(tc.args) as unknown as Record<string, unknown>;
                  chunks.push({ type: "tool_call", toolCall: { id: tc.id, name: tc.name, args: args } });
                } catch {
                  chunks.push({ type: "tool_call", toolCall: { id: tc.id, name: tc.name, args: {} } });
                }
                emittedToolCall = true;
              }
              pendingToolCalls.clear();
            }

            if (parsed.usage && (parsed.usage.prompt_tokens || parsed.usage.completion_tokens)) {
              chunks.push({
                type: "done",
                usage: {
                  inputTokens: parsed.usage.prompt_tokens,
                  outputTokens: parsed.usage.completion_tokens,
                  totalTokens: parsed.usage.total_tokens,
                },
              });
              streamDone = true;
              signal$.notify();
              return;
            }
          } catch (parseErr) {
            console.warn("[llm-hub] Failed to parse SSE data:", data.slice(0, 200), parseErr);
          }
        }
        signal$.notify();
      });

      res.on("end", () => {
        if (!streamDone) {
          // Emit any pending tool calls that weren't emitted via finish_reason or [DONE]
          for (const [, tc] of pendingToolCalls) {
            try {
              const args = JSON.parse(tc.args) as unknown as Record<string, unknown>;
              chunks.push({ type: "tool_call", toolCall: { id: tc.id, name: tc.name, args: args } });
            } catch {
              chunks.push({ type: "tool_call", toolCall: { id: tc.id, name: tc.name, args: {} } });
            }
          }
          pendingToolCalls.clear();
          if (tagBuffer) {
            chunks.push({ type: inThinkTag ? "thinking" : "text", content: tagBuffer });
            tagBuffer = "";
          }
          chunks.push({ type: "done" });
          streamDone = true;
        }
        signal$.notify();
      });

      res.on("error", (err: Error) => {
        streamError = err;
        signal$.notify();
      });
    },
  );

  req.on("error", (err: Error) => {
    streamError = err;
    streamDone = true;
    signal$.notify();
  });

  const onAbort = () => {
    req.destroy();
    streamDone = true;
    signal$.notify();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  req.write(body);
  req.end();

  try {
    while (!streamDone || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
        continue;
      }
      if (streamError !== null) {
        yield { type: "error", error: `Connection failed: ${(streamError as Error).message}` };
        return;
      }
      if (streamDone) break;
      if (signal?.aborted) return;
      const idleTimeoutMs = getStreamIdleTimeoutMs(config);
      const ok = await signal$.wait(idleTimeoutMs);
      if (!ok) {
        yield { type: "error", error: formatStreamIdleTimeoutError(idleTimeoutMs) };
        req.destroy();
        return;
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

