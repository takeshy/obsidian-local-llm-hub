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
import {
  runLocalLlmChat,
  fetchChatModels as fetchChatModelsShared,
  fetchEmbeddingModels as fetchEmbeddingModelsShared,
} from "obsidian-llm-hub-common/core";

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
  yield* runLocalLlmChat({ config, messages, systemPrompt, signal, tools });
}
