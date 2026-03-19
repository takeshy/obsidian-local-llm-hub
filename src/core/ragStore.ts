/**
 * RAG Store
 * Manages chunking, embedding, indexing, and searching of vault notes
 */

import { type App, TFile } from "obsidian";
import type { LocalLlmConfig, RagConfig } from "../types";
import { generateEmbeddings, generateEmbedding } from "./embeddingProvider";
import {
  saveRagIndex,
  loadRagIndex,
  deleteRagIndex,
  type RagIndex,
  type ChunkMeta,
} from "./ragStorage";

const EMBEDDING_FORMAT_VERSION = 2;

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
  private incompatibleIndexLoaded = false;

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
    this.incompatibleIndexLoaded = false;
    if (result) {
      if (result.index.embeddingFormatVersion === EMBEDDING_FORMAT_VERSION) {
        this.index = result.index;
        this.vectors = result.vectors;
      } else {
        this.index = null;
        this.vectors = null;
        this.incompatibleIndexLoaded = true;
      }
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

    // Force fresh load (ignore loaded flag — clear() or version change may have invalidated it)
    this.loaded = false;
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
          const heading = findNearestHeading(content, chunk.startOffset);
          const prefix = heading ? `[${filePath} > ${heading}]\n` : `[${filePath}]\n`;
          const embeddingText = prefix + chunk.text;
          allTexts.push(embeddingText);
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
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
    };
    this.vectors = vectors;

    await saveRagIndex(app, workspaceFolder, this.index, this.vectors);

    return {
      totalChunks: allMeta.length,
      indexedFiles: Object.keys(newChecksums).length,
    };
  }

  /**
   * Sync a single file into the RAG index.
   * If oldPath is provided, removes chunks for that path first (useful for renames).
   */
  async syncFile(
    app: App,
    ragConfig: RagConfig,
    llmConfig: LocalLlmConfig,
    workspaceFolder: string,
    filePath: string,
    oldPath?: string,
  ): Promise<{ path: string; syncedAt: string }> {
    await this.load(app, workspaceFolder);

    if (this.incompatibleIndexLoaded) {
      await this.sync(app, ragConfig, llmConfig, workspaceFolder);
      this.incompatibleIndexLoaded = false;
      return {
        path: filePath,
        syncedAt: new Date().toISOString(),
      };
    }

    const dimension = this.index?.dimension || 0;

    // Collect existing chunks, removing old entries for this file (and oldPath if rename)
    const keptMeta: ChunkMeta[] = [];
    const keptVectors: number[][] = [];
    const pathsToRemove = new Set<string>([filePath]);
    if (oldPath) pathsToRemove.add(oldPath);

    if (this.index && this.vectors) {
      const dim = this.index.dimension;
      for (let i = 0; i < this.index.meta.length; i++) {
        if (!pathsToRemove.has(this.index.meta[i].filePath)) {
          keptMeta.push(this.index.meta[i]);
          keptVectors.push(Array.from(this.vectors.slice(i * dim, (i + 1) * dim)));
        }
      }
    }

    // Update checksums
    const checksums = { ...(this.index?.fileChecksums || {}) };
    if (oldPath) delete checksums[oldPath];

    // Read and embed the file
    const file = app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile && file.extension === "md") {
      const content = await app.vault.cachedRead(file);
      const checksum = simpleChecksum(content);

      // Skip re-embedding if content hasn't changed (and not a rename)
      if (!oldPath && checksum === checksums[filePath]) {
        return { path: filePath, syncedAt: new Date().toISOString() };
      }

      checksums[filePath] = checksum;

      const chunks = chunkText(content, ragConfig.chunkSize, ragConfig.chunkOverlap);
      if (chunks.length > 0) {
        const texts = chunks.map(c => {
          const heading = findNearestHeading(content, c.startOffset);
          const prefix = heading ? `[${filePath} > ${heading}]\n` : `[${filePath}]\n`;
          return prefix + c.text;
        });
        const BATCH_SIZE = 32;
        const newEmbeddings: number[][] = [];
        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
          const batch = texts.slice(i, i + BATCH_SIZE);
          const embeddings = await generateEmbeddings(batch, ragConfig, llmConfig);
          newEmbeddings.push(...embeddings);
        }

        for (let i = 0; i < chunks.length; i++) {
          keptMeta.push({
            filePath,
            startOffset: chunks[i].startOffset,
            text: chunks[i].text,
          });
          keptVectors.push(newEmbeddings[i]);
        }
      }
    } else {
      // File doesn't exist or isn't markdown — just remove it from index
      delete checksums[filePath];
    }

    // Rebuild index
    const newDimension = keptVectors.length > 0 ? keptVectors[0].length : dimension;
    const vectors = new Float32Array(keptMeta.length * newDimension);
    for (let i = 0; i < keptVectors.length; i++) {
      vectors.set(keptVectors[i], i * newDimension);
    }

    this.index = {
      meta: keptMeta,
      dimension: newDimension,
      fileChecksums: checksums,
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
    };
    this.vectors = vectors;

    await saveRagIndex(app, workspaceFolder, this.index, this.vectors);

    return {
      path: filePath,
      syncedAt: new Date().toISOString(),
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

    // Sort by score descending, filter by minimum score, take top K
    scores.sort((a, b) => b.score - a.score);
    const minScore = ragConfig.minScore ?? 0;
    const topK = scores
      .filter(s => s.score >= minScore)
      .slice(0, ragConfig.topK);

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
    this.incompatibleIndexLoaded = false;
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
    .flatMap(p => {
      try { return [new RegExp(p)]; } catch { return []; }
    });

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

export function chunkText(
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
        // Find the best sentence boundary (English ". " or Japanese "。", "！", "？")
        const halfPoint = start + chunkSize / 2;
        const region = text.slice(halfPoint, end);
        const sentencePattern = /[.]\s|[。！？]/g;
        let lastMatch = -1;
        let match: RegExpExecArray | null;
        while ((match = sentencePattern.exec(region)) !== null) {
          lastMatch = halfPoint + match.index + match[0].length;
        }
        if (lastMatch > 0) {
          end = lastMatch;
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

export function simpleChecksum(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Find the nearest Markdown heading before a given offset.
 * Returns the heading text (without the # prefix) or empty string if none.
 */
export function findNearestHeading(text: string, offset: number): string {
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  let lastHeading = "";
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(text)) !== null) {
    if (match.index > offset) {
      break;
    }
    lastHeading = match[2].trim();
  }
  return lastHeading;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
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
