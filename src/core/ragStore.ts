/**
 * RAG Store
 * Manages chunking, embedding, indexing, and searching of vault notes
 */

import type { App, TFile } from "obsidian";
import type { LocalLlmConfig, RagConfig } from "../types";
import { generateEmbeddings, generateEmbedding } from "./embeddingProvider";
import {
  saveRagIndex,
  loadRagIndex,
  deleteRagIndex,
  type RagIndex,
  type ChunkMeta,
} from "./ragStorage";

export interface SyncResult {
  totalChunks: number;
  indexedFiles: number;
}

export interface RagSearchResult {
  text: string;
  filePath: string;
  score: number;
}

class RagStore {
  private index: RagIndex | null = null;
  private vectors: Float32Array | null = null;
  private loaded = false;

  getStatus(): { totalChunks: number; indexedFiles: number } {
    if (!this.index) {
      return { totalChunks: 0, indexedFiles: 0 };
    }
    return {
      totalChunks: this.index.meta.length,
      indexedFiles: Object.keys(this.index.fileChecksums).length,
    };
  }

  /**
   * Load existing index from vault storage
   */
  async load(app: App, workspaceFolder: string): Promise<void> {
    if (this.loaded) return;
    const result = await loadRagIndex(app, workspaceFolder);
    if (result) {
      this.index = result.index;
      this.vectors = result.vectors;
    }
    this.loaded = true;
  }

  /**
   * Sync vault notes into the RAG index
   */
  async sync(
    app: App,
    ragConfig: RagConfig,
    llmConfig: LocalLlmConfig,
    workspaceFolder: string,
  ): Promise<SyncResult> {
    // Get markdown files matching target/exclude criteria
    const files = getTargetFiles(app, ragConfig, workspaceFolder);

    // Compute checksums for all files
    const newChecksums: Record<string, string> = {};
    const fileContents: Map<string, string> = new Map();

    for (const file of files) {
      const content = await app.vault.cachedRead(file);
      const checksum = simpleChecksum(content);
      newChecksums[file.path] = checksum;
      fileContents.set(file.path, content);
    }

    // Load existing index
    await this.load(app, workspaceFolder);
    const oldChecksums = this.index?.fileChecksums || {};

    // Find files that changed
    const changedFiles: string[] = [];
    const unchangedChunks: { meta: ChunkMeta[]; vectors: number[][] } = {
      meta: [],
      vectors: [],
    };

    // Keep chunks from unchanged files
    if (this.index && this.vectors) {
      for (let i = 0; i < this.index.meta.length; i++) {
        const chunk = this.index.meta[i];
        if (newChecksums[chunk.filePath] === oldChecksums[chunk.filePath]) {
          unchangedChunks.meta.push(chunk);
          const dim = this.index.dimension;
          const vec = Array.from(this.vectors.slice(i * dim, (i + 1) * dim));
          unchangedChunks.vectors.push(vec);
        }
      }
    }

    // Find changed or new files
    for (const [filePath, checksum] of Object.entries(newChecksums)) {
      if (checksum !== oldChecksums[filePath]) {
        changedFiles.push(filePath);
      }
    }

    // Chunk and embed changed files
    const newChunks: ChunkMeta[] = [];
    const newEmbeddings: number[][] = [];

    if (changedFiles.length > 0) {
      const allTexts: string[] = [];
      const allMetas: ChunkMeta[] = [];

      for (const filePath of changedFiles) {
        const content = fileContents.get(filePath);
        if (!content) continue;

        const chunks = chunkText(content, ragConfig.chunkSize, ragConfig.chunkOverlap);
        for (const chunk of chunks) {
          allTexts.push(chunk.text);
          allMetas.push({
            filePath,
            startOffset: chunk.startOffset,
            text: chunk.text,
          });
        }
      }

      // Batch embed (max 32 at a time to avoid server issues)
      const BATCH_SIZE = 32;
      for (let i = 0; i < allTexts.length; i += BATCH_SIZE) {
        const batch = allTexts.slice(i, i + BATCH_SIZE);
        const embeddings = await generateEmbeddings(batch, ragConfig, llmConfig);
        newEmbeddings.push(...embeddings);
      }

      newChunks.push(...allMetas);
    }

    // Merge unchanged + new
    const allMeta = [...unchangedChunks.meta, ...newChunks];
    const allVectorArrays = [...unchangedChunks.vectors, ...newEmbeddings];

    // Determine dimension
    const dimension = allVectorArrays.length > 0 ? allVectorArrays[0].length : 0;

    // Build flat Float32Array
    const vectors = new Float32Array(allMeta.length * dimension);
    for (let i = 0; i < allVectorArrays.length; i++) {
      vectors.set(allVectorArrays[i], i * dimension);
    }

    // Save
    this.index = {
      meta: allMeta,
      dimension,
      fileChecksums: newChecksums,
    };
    this.vectors = vectors;

    await saveRagIndex(app, workspaceFolder, this.index, this.vectors);

    return {
      totalChunks: allMeta.length,
      indexedFiles: Object.keys(newChecksums).length,
    };
  }

  /**
   * Search for similar chunks
   */
  async search(
    query: string,
    ragConfig: RagConfig,
    llmConfig: LocalLlmConfig,
    app: App,
    workspaceFolder: string,
  ): Promise<RagSearchResult[]> {
    await this.load(app, workspaceFolder);

    if (!this.index || !this.vectors || this.index.meta.length === 0) {
      return [];
    }

    const queryEmbedding = await generateEmbedding(query, ragConfig, llmConfig);
    const queryVec = new Float32Array(queryEmbedding);
    const dim = this.index.dimension;

    // Compute cosine similarities
    const scores: { index: number; score: number }[] = [];
    for (let i = 0; i < this.index.meta.length; i++) {
      const chunkVec = this.vectors.slice(i * dim, (i + 1) * dim);
      const score = cosineSimilarity(queryVec, chunkVec);
      scores.push({ index: i, score });
    }

    // Sort by score descending, take top K
    scores.sort((a, b) => b.score - a.score);
    const topK = scores.slice(0, ragConfig.topK);

    return topK.map(({ index, score }) => ({
      text: this.index!.meta[index].text,
      filePath: this.index!.meta[index].filePath,
      score,
    }));
  }

  /**
   * Clear the entire RAG index
   */
  async clear(app: App, workspaceFolder: string): Promise<void> {
    this.index = null;
    this.vectors = null;
    this.loaded = false;
    await deleteRagIndex(app, workspaceFolder);
  }
}

// Singleton
let ragStoreInstance: RagStore | null = null;

export function getRagStore(): RagStore {
  if (!ragStoreInstance) {
    ragStoreInstance = new RagStore();
  }
  return ragStoreInstance;
}

// --- Utility functions ---

function getTargetFiles(app: App, ragConfig: RagConfig, workspaceFolder: string): TFile[] {
  const files = app.vault.getMarkdownFiles();
  const excludeRegexes = ragConfig.excludePatterns
    .filter(Boolean)
    .map(p => new RegExp(p));

  return files.filter(file => {
    // Skip workspace folder
    if (file.path.startsWith(workspaceFolder + "/")) return false;

    // Check target folders
    if (ragConfig.targetFolders.length > 0) {
      const inTarget = ragConfig.targetFolders.some(folder =>
        file.path.startsWith(folder + "/") || file.path === folder
      );
      if (!inTarget) return false;
    }

    // Check exclude patterns
    for (const regex of excludeRegexes) {
      if (regex.test(file.path)) return false;
    }

    return true;
  });
}

function chunkText(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): { text: string; startOffset: number }[] {
  const chunks: { text: string; startOffset: number }[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    // Try to break at paragraph/sentence boundary
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + chunkSize / 2) {
        end = paragraphBreak;
      } else {
        const sentenceBreak = text.lastIndexOf(". ", end);
        if (sentenceBreak > start + chunkSize / 2) {
          end = sentenceBreak + 1;
        }
      }
    }

    const chunkText = text.slice(start, end).trim();
    if (chunkText) {
      chunks.push({ text: chunkText, startOffset: start });
    }

    start = end - chunkOverlap;
    if (start <= chunks[chunks.length - 1]?.startOffset) {
      start = end; // Prevent infinite loop
    }
  }

  return chunks;
}

function simpleChecksum(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
