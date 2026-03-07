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

// OpenAI-compatible API types
interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

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

interface OpenAiModel {
  id: string;
  object?: string;
}

interface OpenAiModelsResponse {
  data: OpenAiModel[];
}

/** Families that are embedding-only models (not usable for chat) */
const EMBEDDING_FAMILIES = new Set(["nomic-bert", "bert", "snowflake-arctic-embed"]);

/**
 * Verify connection to local LLM server and check available models
 */
export async function verifyLocalLlm(config: LocalLlmConfig): Promise<{
  success: boolean;
  error?: string;
  models?: string[];
}> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    if (config.framework === "ollama") {
      // Use Ollama's /api/tags (has model family info for filtering embedding models)
      try {
        const ollamaResponse = await requestUrl({
          url: `${config.baseUrl}/api/tags`,
          method: "GET",
        });
        const ollamaData = ollamaResponse.json as {
          models?: { name: string; details?: { families?: string[] } }[];
        };
        const models = (ollamaData.models || [])
          .filter(m => !isEmbeddingModel(m.details?.families))
          .map(m => m.name);
        return { success: true, models };
      } catch {
        return { success: false, error: `Cannot connect to ${config.baseUrl}. Is the server running?` };
      }
    }

    // OpenAI-compatible /v1/models (LM Studio, vLLM, etc.)
    try {
      const response = await requestUrl({
        url: `${config.baseUrl}/v1/models`,
        method: "GET",
        headers,
      });
      const data = response.json as OpenAiModelsResponse;
      const models = data.data?.map((m: OpenAiModel) => m.id) || [];
      return { success: true, models };
    } catch {
      return { success: false, error: `Cannot connect to ${config.baseUrl}. Is the server running?` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

function isEmbeddingModel(families?: string[]): boolean {
  if (!families) return false;
  return families.some(f => EMBEDDING_FAMILIES.has(f));
}

/**
 * Fetch available models from the local LLM server
 */
export async function fetchLocalLlmModels(config: LocalLlmConfig): Promise<string[]> {
  const result = await verifyLocalLlm(config);
  return result.models || [];
}

/**
 * Fetch available embedding models.
 * Ollama: filters by family (BERT-based models only).
 * Others: returns all models from /v1/models (user selects the right one).
 */
export async function fetchEmbeddingModels(config: LocalLlmConfig): Promise<string[]> {
  try {
    if (config.framework === "ollama") {
      const response = await requestUrl({
        url: `${config.baseUrl}/api/tags`,
        method: "GET",
      });
      const data = response.json as {
        models?: { name: string; details?: { families?: string[] } }[];
      };
      return (data.models || [])
        .filter(m => isEmbeddingModel(m.details?.families))
        .map(m => m.name);
    }

    // LM Studio, vLLM, etc.: return all loaded models
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }
    const response = await requestUrl({
      url: `${config.baseUrl}/v1/models`,
      method: "GET",
      headers,
    });
    const data = response.json as OpenAiModelsResponse;
    return data.data?.map((m: OpenAiModel) => m.id) || [];
  } catch {
    return [];
  }
}

/**
 * Stream chat completion from a local LLM server.
 * Ollama: uses native /api/chat (NDJSON, immediate streaming).
 * LM Studio: uses /v1/chat/completions (OpenAI SSE).
 */
export async function* localLlmChatStream(
  config: LocalLlmConfig,
  messages: Message[],
  systemPrompt: string,
  signal?: AbortSignal,
  tools?: ToolDefinition[],
): AsyncGenerator<StreamChunk> {
  const activeTools = tools && tools.length > 0 ? tools : undefined;
  if (config.framework === "ollama") {
    yield* ollamaChatStream(config, messages, systemPrompt, signal, activeTools);
  } else {
    yield* openaiChatStream(config, messages, systemPrompt, signal, activeTools);
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
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
    } else {
      ollamaMessages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
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
  let streamResolve: (() => void) | null = null;
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
        res.on("data", (chunk: Buffer) => { errorBody += chunk.toString(); });
        res.on("end", () => {
          chunks.push({ type: "error", error: `HTTP ${res.statusCode}: ${errorBody.slice(0, 200) || res.statusMessage}` });
          streamDone = true;
          streamResolve?.();
        });
        return;
      }

      let buffer = "";
      let loggedFirst = false;

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed) as {
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
            };

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
                  arguments: tc.function.arguments,
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
              streamResolve?.();
              return;
            }
          } catch (parseErr) {
            console.warn("[llm-hub] Failed to parse Ollama NDJSON:", trimmed.slice(0, 200), parseErr);
          }
        }
        streamResolve?.();
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
        streamResolve?.();
      });

      res.on("error", (err: Error) => {
        streamError = err;
        streamResolve?.();
      });
    },
  );

  req.on("error", (err: Error) => {
    streamError = err;
    streamDone = true;
    streamResolve?.();
  });

  const onAbort = () => {
    req.destroy();
    streamDone = true;
    streamResolve?.();
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
      await new Promise<void>((resolve) => { streamResolve = resolve; });
    }
    if (streamError !== null) {
      yield { type: "error", error: `Connection failed: ${(streamError as Error).message}` };
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
  const openaiMessages: OpenAiMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of messages) {
    if (msg.role === "tool") {
      openaiMessages.push({
        role: "tool",
        content: msg.content,
        tool_call_id: msg.toolCallId,
      });
    } else if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      openaiMessages.push({
        role: "assistant",
        content: msg.content,
        tool_calls: msg.toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else {
      openaiMessages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }
  }

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

  if (tools) {
    requestBody.tools = tools;
  }
  const body = JSON.stringify(requestBody);

  const url = new URL(`${config.baseUrl}/v1/chat/completions`);
  const httpModule = getHttpModule(url.protocol);

  const chunks: StreamChunk[] = [];
  let streamResolve: (() => void) | null = null;
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
        res.on("data", (chunk: Buffer) => { errorBody += chunk.toString(); });
        res.on("end", () => {
          chunks.push({ type: "error", error: `HTTP ${res.statusCode}: ${errorBody.slice(0, 200) || res.statusMessage}` });
          streamDone = true;
          streamResolve?.();
        });
        return;
      }

      let buffer = "";
      let inThinkTag = false;
      let tagBuffer = "";

      // Accumulate tool call arguments across SSE chunks
      const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();

      res.on("data", (chunk: Buffer) => {
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
                const args = JSON.parse(tc.args) as Record<string, unknown>;
                chunks.push({ type: "tool_call", toolCall: { id: tc.id, name: tc.name, arguments: args } });
              } catch {
                chunks.push({ type: "tool_call", toolCall: { id: tc.id, name: tc.name, arguments: {} } });
              }
            }
            pendingToolCalls.clear();
            if (tagBuffer) {
              chunks.push({ type: inThinkTag ? "thinking" : "text", content: tagBuffer });
              tagBuffer = "";
            }
            chunks.push({ type: "done" });
            streamDone = true;
            streamResolve?.();
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
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
            };
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

            // finish_reason: "tool_calls" means all tool calls are complete
            if (choice?.finish_reason === "tool_calls") {
              for (const [, tc] of pendingToolCalls) {
                try {
                  const args = JSON.parse(tc.args) as Record<string, unknown>;
                  chunks.push({ type: "tool_call", toolCall: { id: tc.id, name: tc.name, arguments: args } });
                } catch {
                  chunks.push({ type: "tool_call", toolCall: { id: tc.id, name: tc.name, arguments: {} } });
                }
              }
              pendingToolCalls.clear();
            }

            if (parsed.usage) {
              chunks.push({
                type: "done",
                usage: {
                  inputTokens: parsed.usage.prompt_tokens,
                  outputTokens: parsed.usage.completion_tokens,
                  totalTokens: parsed.usage.total_tokens,
                },
              });
              streamDone = true;
              streamResolve?.();
              return;
            }
          } catch (parseErr) {
            console.warn("[llm-hub] Failed to parse SSE data:", data.slice(0, 200), parseErr);
          }
        }
        streamResolve?.();
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
        streamResolve?.();
      });

      res.on("error", (err: Error) => {
        streamError = err;
        streamResolve?.();
      });
    },
  );

  req.on("error", (err: Error) => {
    streamError = err;
    streamDone = true;
    streamResolve?.();
  });

  const onAbort = () => {
    req.destroy();
    streamDone = true;
    streamResolve?.();
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
      await new Promise<void>((resolve) => { streamResolve = resolve; });
    }
    if (streamError !== null) {
      yield { type: "error", error: `Connection failed: ${(streamError as Error).message}` };
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Load Node.js http or https module (desktop only, bypasses CORS). */
function getHttpModule(protocol: string): typeof import("http") {
  const loader =
    (globalThis as unknown as { require?: (id: string) => unknown }).require ||
    (globalThis as unknown as { module?: { require?: (id: string) => unknown } }).module?.require;
  if (!loader) {
    throw new Error("Node.js http module is not available in this environment");
  }
  const moduleName = protocol === "https:" ? "https" : "http";
  return loader(moduleName) as typeof import("http");
}

/**
 * Parse <think>...</think> tags from streaming content.
 */
function parseThinkTags(
  content: string,
  inThinkTag: boolean,
  tagBuffer: string,
): { items: StreamChunk[]; inThinkTag: boolean; tagBuffer: string } {
  const items: StreamChunk[] = [];
  let text = tagBuffer + content;
  tagBuffer = "";

  while (text.length > 0) {
    if (!inThinkTag) {
      const openIdx = text.indexOf("<think>");
      if (openIdx !== -1) {
        if (openIdx > 0) {
          items.push({ type: "text", content: text.slice(0, openIdx) });
        }
        inThinkTag = true;
        text = text.slice(openIdx + 7);
      } else {
        const partial = getPartialTagMatch(text, "<think>");
        if (partial > 0) {
          const safe = text.slice(0, text.length - partial);
          if (safe) items.push({ type: "text", content: safe });
          tagBuffer = text.slice(text.length - partial);
          text = "";
        } else {
          items.push({ type: "text", content: text });
          text = "";
        }
      }
    } else {
      const closeIdx = text.indexOf("</think>");
      if (closeIdx !== -1) {
        if (closeIdx > 0) {
          items.push({ type: "thinking", content: text.slice(0, closeIdx) });
        }
        inThinkTag = false;
        text = text.slice(closeIdx + 8);
      } else {
        const partial = getPartialTagMatch(text, "</think>");
        if (partial > 0) {
          const safe = text.slice(0, text.length - partial);
          if (safe) items.push({ type: "thinking", content: safe });
          tagBuffer = text.slice(text.length - partial);
          text = "";
        } else {
          items.push({ type: "thinking", content: text });
          text = "";
        }
      }
    }
  }

  return { items, inThinkTag, tagBuffer };
}

/** Check if the end of `text` is a prefix of `tag`. Returns match length (0 if none). */
function getPartialTagMatch(text: string, tag: string): number {
  const maxCheck = Math.min(text.length, tag.length - 1);
  for (let len = maxCheck; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) {
      return len;
    }
  }
  return 0;
}
