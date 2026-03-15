/**
 * Embedding Provider
 * Generates embeddings via OpenAI-compatible /v1/embeddings endpoint
 * Uses Obsidian's requestUrl to bypass CORS
 */

import { requestUrl } from "obsidian";
import type { LocalLlmConfig, RagConfig } from "../types";

interface EmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

/**
 * Get the embedding server base URL.
 * Uses ragConfig.embeddingBaseUrl if set, otherwise falls back to LLM server.
 */
function getEmbeddingBaseUrl(ragConfig: RagConfig, llmConfig: LocalLlmConfig): string {
  return ragConfig.embeddingBaseUrl || llmConfig.baseUrl;
}

/**
 * Generate embeddings for a batch of texts
 */
export async function generateEmbeddings(
  texts: string[],
  ragConfig: RagConfig,
  llmConfig: LocalLlmConfig,
): Promise<number[][]> {
  const baseUrl = getEmbeddingBaseUrl(ragConfig, llmConfig);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (llmConfig.apiKey) {
    headers["Authorization"] = `Bearer ${llmConfig.apiKey}`;
  }

  const pathPrefix = !ragConfig.embeddingBaseUrl && llmConfig.framework === "anythingllm" ? "/v1/openai" : "/v1";
  const response = await requestUrl({
    url: `${baseUrl}${pathPrefix}/embeddings`,
    method: "POST",
    headers,
    body: JSON.stringify({
      model: ragConfig.embeddingModel,
      input: texts,
    }),
  });

  const data = response.json as EmbeddingResponse;
  // Sort by index to maintain order
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return sorted.map(d => d.embedding);
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(
  text: string,
  ragConfig: RagConfig,
  llmConfig: LocalLlmConfig,
): Promise<number[]> {
  const results = await generateEmbeddings([text], ragConfig, llmConfig);
  return results[0];
}
