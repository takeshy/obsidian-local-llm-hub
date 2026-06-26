/**
 * RAG Store
 * Manages chunking, embedding, indexing, and searching of vault notes.
 * Supports multiple named RAG settings, each with its own index.
 */

import { type App, TFile, loadPdfJs } from "obsidian";
import type { LocalLlmConfig, RagSetting } from "../types";
import { WORKSPACE_FOLDER } from "../types";
import { generateEmbeddings, generateEmbedding } from "./embeddingProvider";
import {
  saveRagIndex,
  loadRagIndex,
  loadRagVectors,
  deleteRagIndex,
  loadExternalRagIndex,
  loadExternalRagVectors,
  type RagIndex,
  type ChunkMeta,
} from "./ragStorage";

const EMBEDDING_FORMAT_VERSION = 2;
const DEFAULT_EMBEDDING_BATCH_SIZE = 32;
const OLLAMA_EMBEDDING_BATCH_SIZE = 4;
const MAX_CHANGED_FILES_PER_SYNC = 50;
const SCAN_YIELD_INTERVAL = 25;

export interface SyncResult {
  totalChunks: number;
  indexedFiles: number;
  deferredFiles?: number;
  failedFiles?: string[];
}

export interface RagSyncProgress {
  current: number;
  total: number;
  filePath: string;
  phase?: "scanning" | "embedding" | "saving";
}

export interface RagSearchResult {
  text: string;
  filePath: string;
  score: number;
  startOffset: number;        // chunk start offset in the source document
  heading?: string;           // nearest Markdown heading (omitted for PDFs)
  contentType?: string;       // "pdf" for PDF-origin chunks
  pageLabel?: string;         // PDF page range (e.g. "pages 1-6 of 24")
}

export interface RagStatus {
  totalChunks: number;
  indexedFiles: number;
}

function createAbortError(): Error {
  const error = new Error("Sync aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function isOllamaDefaultUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return port === "11434" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function getEmbeddingBatchSize(ragSetting: RagSetting, llmConfig: LocalLlmConfig): number {
  const embeddingBaseUrl = ragSetting.embeddingBaseUrl || llmConfig.baseUrl;
  return llmConfig.framework === "ollama" || isOllamaDefaultUrl(embeddingBaseUrl)
    ? OLLAMA_EMBEDDING_BATCH_SIZE
    : DEFAULT_EMBEDDING_BATCH_SIZE;
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>(resolve => window.setTimeout(resolve, 0));
}

interface StoreEntry {
  index: RagIndex | null;
  vectors: Float32Array | null;
  loaded: boolean;
  incompatibleIndexLoaded: boolean;
}

interface LoadOptions {
  externalIndexPath?: string;
  sourceRagSettings?: string[];
}

export function parseExternalIndexPaths(externalIndexPath: string): string[] {
  return externalIndexPath
    .split(/\n+/)
    .map(path => path.trim())
    .filter(path => path.length > 0);
}

function mergeLoadedIndexes(loadedIndexes: { index: RagIndex; vectors: Float32Array }[]): {
  index: RagIndex | null;
  vectors: Float32Array | null;
} {
  if (loadedIndexes.length === 0) {
    return { index: null, vectors: null };
  }

  const dimension = loadedIndexes[0].index.dimension;
  if (dimension <= 0) {
    return { index: null, vectors: null };
  }

  const compatibleIndexes = loadedIndexes.filter(item =>
    item.index.dimension === dimension &&
    item.vectors.length >= item.index.meta.length * dimension
  );
  if (compatibleIndexes.length === 0) {
    return { index: null, vectors: null };
  }

  const totalChunks = compatibleIndexes.reduce((sum, item) => sum + item.index.meta.length, 0);
  const mergedVectors = new Float32Array(totalChunks * dimension);
  const mergedMeta: ChunkMeta[] = [];
  const mergedChecksums: Record<string, string> = {};
  let offset = 0;

  for (const item of compatibleIndexes) {
    mergedMeta.push(...item.index.meta);
    Object.assign(mergedChecksums, item.index.fileChecksums ?? {});
    const vectorLength = item.index.meta.length * dimension;
    mergedVectors.set(item.vectors.subarray(0, vectorLength), offset);
    offset += vectorLength;
  }

  return {
    index: {
      meta: mergedMeta,
      dimension,
      fileChecksums: mergedChecksums,
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
      chunkSize: compatibleIndexes[0].index.chunkSize,
      chunkOverlap: compatibleIndexes[0].index.chunkOverlap,
      chunkStrategy: compatibleIndexes[0].index.chunkStrategy,
    },
    vectors: mergedVectors,
  };
}

class RagStore {
  private entries = new Map<string, StoreEntry>();
  private externalPaths = new Map<string, string>();
  private sourceRagSettings = new Map<string, string[]>();

  async load(app: App, settingNames: string[], ragSettings?: Record<string, RagSetting>): Promise<void> {
    if (ragSettings) {
      for (const [name, setting] of Object.entries(ragSettings)) {
        if (setting.externalIndexPath) {
          this.externalPaths.set(name, setting.externalIndexPath);
        }
        this.setSourceRagSettings(name, setting.sourceRagSettings);
      }
    }
    for (const name of settingNames) {
      await this.ensureLoaded(app, name, {
        externalIndexPath: ragSettings?.[name]?.externalIndexPath,
        sourceRagSettings: ragSettings?.[name]?.sourceRagSettings,
      });
    }
  }

  setExternalPath(settingName: string, externalPath: string): void {
    if (externalPath) {
      this.externalPaths.set(settingName, externalPath);
    } else {
      this.externalPaths.delete(settingName);
    }
    // Invalidate cache so next access reloads
    this.entries.delete(settingName);
  }

  setSourceRagSettings(settingName: string, sourceNames: string[]): void {
    const filtered = sourceNames.filter(sourceName => sourceName !== settingName);
    if (filtered.length > 0) {
      this.sourceRagSettings.set(settingName, filtered);
    } else {
      this.sourceRagSettings.delete(settingName);
    }
    this.entries.delete(settingName);
  }

  invalidateEntry(settingName: string): void {
    this.entries.delete(settingName);
    this.externalPaths.delete(settingName);
    this.sourceRagSettings.delete(settingName);
  }

  getStatus(settingName: string): RagStatus {
    const entry = this.entries.get(settingName);
    if (!entry?.index) {
      return { totalChunks: 0, indexedFiles: 0 };
    }
    return {
      totalChunks: entry.index.meta.length,
      indexedFiles: entry.index.fileChecksums ? Object.keys(entry.index.fileChecksums).length : 0,
    };
  }

  isExternal(settingName: string): boolean {
    return this.externalPaths.has(settingName);
  }

  /**
   * Sync vault notes into the RAG index for a named setting
   */
  async sync(
    app: App,
    settingName: string,
    ragSetting: RagSetting,
    llmConfig: LocalLlmConfig,
    signal?: AbortSignal,
    onProgress?: (progress: RagSyncProgress) => void,
  ): Promise<SyncResult> {
    // Get markdown files matching target/exclude criteria
    const files = getTargetFiles(app, ragSetting);
    const totalFiles = files.length;

    // Force fresh load before scanning so unchanged PDFs can skip text extraction.
    this.entries.delete(settingName);
    const entry = await this.ensureLoaded(app, settingName, {
      externalIndexPath: ragSetting.externalIndexPath,
      sourceRagSettings: ragSetting.sourceRagSettings,
    });
    let { index, vectors } = entry;
    const incompatible = entry.incompatibleIndexLoaded;

    // Check if chunk params changed → full rebuild needed
    const needsFullRebuild = !incompatible && index !== null && (
      index.chunkSize !== ragSetting.chunkSize ||
      index.chunkOverlap !== ragSetting.chunkOverlap ||
      index.chunkStrategy !== (ragSetting.chunkStrategy ?? "fixed")
    );

    if (incompatible || needsFullRebuild) {
      index = null;
      vectors = null;
    }

    const oldChecksums = index?.fileChecksums || {};

    // Compute checksums for all files
    const newChecksums: Record<string, string> = {};
    const fileContents = new Map<string, string>();
    const pdfInfoMap = new Map<string, PdfExtractResult>();
    const migratedPdfChecksums = new Set<string>();
    const failedFiles: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      throwIfAborted(signal);
      onProgress?.({
        current: i + 1,
        total: totalFiles,
        filePath: file.path,
        phase: "scanning",
      });
      if (file.extension === "pdf") {
        const checksum = await fileChecksum(app, file);
        newChecksums[file.path] = checksum;
        if (checksum === oldChecksums[file.path]) {
          continue;
        }
      } else {
        const content = await app.vault.cachedRead(file);
        const checksum = simpleChecksum(content);
        newChecksums[file.path] = checksum;
      }
      if ((i + 1) % SCAN_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
      }
    }

    // Find files that changed
    let changedFiles: string[] = [];
    for (const [filePath, checksum] of Object.entries(newChecksums)) {
      if (checksum !== oldChecksums[filePath]) {
        changedFiles.push(filePath);
      }
    }

    // Cap each sync pass so large first-time vaults can make progress without
    // keeping every extracted document and embedding in memory at once.
    const deferredFiles = changedFiles.slice(MAX_CHANGED_FILES_PER_SYNC);
    changedFiles = changedFiles.slice(0, MAX_CHANGED_FILES_PER_SYNC);
    for (const deferredPath of deferredFiles) {
      fileContents.delete(deferredPath);
      if (oldChecksums[deferredPath]) {
        newChecksums[deferredPath] = oldChecksums[deferredPath];
      } else {
        delete newChecksums[deferredPath];
      }
    }

    for (const filePath of changedFiles) {
      const file = app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) {
        delete newChecksums[filePath];
        continue;
      }

      if (file.extension !== "pdf") {
        fileContents.set(filePath, await app.vault.cachedRead(file));
        if (fileContents.size % SCAN_YIELD_INTERVAL === 0) {
          await yieldToEventLoop();
        }
        continue;
      }

      let result: PdfExtractResult | null;
      try {
        result = await extractPdfText(app, file);
      } catch (err) {
        // Extraction failed — keep the checksum so the same unreadable PDF does not block later syncs.
        console.warn(`Local LLM Hub: PDF extraction failed for ${filePath}:`, err);
        failedFiles.push(filePath);
        continue;
      }
      if (!result) {
        failedFiles.push(filePath);
        continue; // skip PDFs with no extractable text
      }
      if (oldChecksums[filePath] && simpleChecksum(result.text) === oldChecksums[filePath]) {
        migratedPdfChecksums.add(filePath);
        continue;
      }
      fileContents.set(filePath, result.text);
      pdfInfoMap.set(filePath, result);
      await yieldToEventLoop();
    }

    const unchangedChunks: { meta: ChunkMeta[]; vectors: number[][] } = {
      meta: [],
      vectors: [],
    };

    // Keep chunks from unchanged, deferred, migrated, and failed-extraction files.
    if (index && vectors) {
      for (let i = 0; i < index.meta.length; i++) {
        const chunk = index.meta[i];
        if (newChecksums[chunk.filePath] === oldChecksums[chunk.filePath] || migratedPdfChecksums.has(chunk.filePath)) {
          unchangedChunks.meta.push(chunk);
          const dim = index.dimension;
          const vec = Array.from(vectors.slice(i * dim, (i + 1) * dim));
          unchangedChunks.vectors.push(vec);
        }
      }
    }

    // Chunk and embed changed files
    const newChunks: ChunkMeta[] = [];
    const newEmbeddings: number[][] = [];

    if (changedFiles.length > 0) {
      const allTexts: string[] = [];
      const allMetas: ChunkMeta[] = [];

      for (const filePath of changedFiles) {
        throwIfAborted(signal);
        const content = fileContents.get(filePath);
        if (!content) continue;

        const isPdf = filePath.endsWith(".pdf");
        const pdfInfo = isPdf ? pdfInfoMap.get(filePath) : undefined;
        const chunks = chunkContent(content, ragSetting);
        for (const chunk of chunks) {
          const heading = isPdf ? null : findNearestHeading(content, chunk.startOffset);
          const prefix = heading ? `[${filePath} > ${heading}]\n` : `[${filePath}]\n`;
          const embeddingText = prefix + chunk.text;
          allTexts.push(embeddingText);
          const meta: ChunkMeta = {
            filePath,
            startOffset: chunk.startOffset,
            text: chunk.text,
          };
          if (isPdf) {
            meta.contentType = "pdf";
            if (pdfInfo) {
              meta.pageLabel = computePageLabel(
                chunk.startOffset, chunk.startOffset + chunk.text.length,
                pdfInfo.pageOffsets, pdfInfo.numPages,
              );
            }
          }
          allMetas.push(meta);
        }
      }

      // Batch embed (max 32 at a time)
      const BATCH_SIZE = getEmbeddingBatchSize(ragSetting, llmConfig);
      const totalBatches = Math.ceil(allTexts.length / BATCH_SIZE);
      onProgress?.({
        current: 0,
        total: totalBatches,
        filePath: allMetas[0]?.filePath ?? "",
        phase: "embedding",
      });
      for (let i = 0; i < allTexts.length; i += BATCH_SIZE) {
        throwIfAborted(signal);
        const batch = allTexts.slice(i, i + BATCH_SIZE);
        const embeddings = await generateEmbeddings(batch, ragSetting, llmConfig);
        throwIfAborted(signal);
        newEmbeddings.push(...embeddings);
        onProgress?.({
          current: Math.floor(i / BATCH_SIZE) + 1,
          total: totalBatches,
          filePath: allMetas[Math.min(i + BATCH_SIZE, allMetas.length - 1)]?.filePath ?? "",
          phase: "embedding",
        });
      }

      newChunks.push(...allMetas);
    }

    // Merge unchanged + new
    const allMeta = [...unchangedChunks.meta, ...newChunks];
    const allVectorArrays = [...unchangedChunks.vectors, ...newEmbeddings];

    // Determine dimension
    const dimension = allVectorArrays.length > 0 ? allVectorArrays[0].length : 0;

    // Build flat Float32Array
    const newVectors = new Float32Array(allMeta.length * dimension);
    for (let i = 0; i < allVectorArrays.length; i++) {
      newVectors.set(allVectorArrays[i], i * dimension);
    }

    throwIfAborted(signal);
    onProgress?.({
      current: 1,
      total: 1,
      filePath: "",
      phase: "saving",
    });

    // Save
    const newIndex: RagIndex = {
      meta: allMeta,
      dimension,
      fileChecksums: newChecksums,
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
      chunkSize: ragSetting.chunkSize,
      chunkOverlap: ragSetting.chunkOverlap,
      chunkStrategy: ragSetting.chunkStrategy ?? "fixed",
    };

    this.entries.set(settingName, {
      index: newIndex,
      vectors: newVectors,
      loaded: true,
      incompatibleIndexLoaded: false,
    });

    await saveRagIndex(app, settingName, newIndex, newVectors);

    return {
      totalChunks: allMeta.length,
      indexedFiles: Object.keys(newChecksums).length,
      deferredFiles: deferredFiles.length,
      failedFiles,
    };
  }

  /**
   * Sync a single file into the RAG index.
   */
  async syncFile(
    app: App,
    settingName: string,
    ragSetting: RagSetting,
    llmConfig: LocalLlmConfig,
    filePath: string,
    oldPath?: string,
  ): Promise<{ path: string; syncedAt: string }> {
    const entry = await this.ensureLoaded(app, settingName, {
      externalIndexPath: ragSetting.externalIndexPath,
      sourceRagSettings: ragSetting.sourceRagSettings,
    });

    if (entry.incompatibleIndexLoaded) {
      await this.sync(app, settingName, ragSetting, llmConfig);
      return { path: filePath, syncedAt: new Date().toISOString() };
    }

    const { index, vectors } = entry;
    const dimension = index?.dimension || 0;

    // Collect existing chunks, removing old entries for this file
    const keptMeta: ChunkMeta[] = [];
    const keptVectors: number[][] = [];
    const pathsToRemove = new Set<string>([filePath]);
    if (oldPath) pathsToRemove.add(oldPath);

    if (index && vectors) {
      const dim = index.dimension;
      for (let i = 0; i < index.meta.length; i++) {
        if (!pathsToRemove.has(index.meta[i].filePath)) {
          keptMeta.push(index.meta[i]);
          keptVectors.push(Array.from(vectors.slice(i * dim, (i + 1) * dim)));
        }
      }
    }

    // Update checksums
    const checksums = { ...(index?.fileChecksums || {}) };
    if (oldPath) delete checksums[oldPath];

    // Read and embed the file
    const file = app.vault.getAbstractFileByPath(filePath);
    const isSupportedFile = file instanceof TFile && (file.extension === "md" || file.extension === "pdf");
    if (isSupportedFile) {
      const isPdf = file.extension === "pdf";
      let content: string | null;
      let pdfInfo: PdfExtractResult | undefined;
      const markdownContent = isPdf ? null : await app.vault.cachedRead(file);
      const checksum = isPdf ? await fileChecksum(app, file) : simpleChecksum(markdownContent ?? "");

      if (!oldPath && checksum === checksums[filePath]) {
        return { path: filePath, syncedAt: new Date().toISOString() };
      }

      if (isPdf) {
        let result: PdfExtractResult | null;
        try {
          result = await extractPdfText(app, file);
        } catch (err) {
          // Extraction failed — preserve existing chunks, don't modify the index
          console.warn(`Local LLM Hub: PDF extraction failed for ${filePath}:`, err);
          return { path: filePath, syncedAt: new Date().toISOString() };
        }
        if (!result) {
          content = null;
          delete checksums[filePath];
        } else {
          content = result.text;
          pdfInfo = result;
        }
      } else {
        content = markdownContent;
      }

      if (content) {
        checksums[filePath] = checksum;

        const chunks = chunkContent(content, ragSetting);
        if (chunks.length > 0) {
          const texts = chunks.map(c => {
            const heading = isPdf ? null : findNearestHeading(content, c.startOffset);
            const prefix = heading ? `[${filePath} > ${heading}]\n` : `[${filePath}]\n`;
            return prefix + c.text;
          });
          const BATCH_SIZE = getEmbeddingBatchSize(ragSetting, llmConfig);
          const newEmbeddings: number[][] = [];
          for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const batch = texts.slice(i, i + BATCH_SIZE);
            const embeddings = await generateEmbeddings(batch, ragSetting, llmConfig);
            newEmbeddings.push(...embeddings);
          }

          for (let i = 0; i < chunks.length; i++) {
            const meta: ChunkMeta = {
              filePath,
              startOffset: chunks[i].startOffset,
              text: chunks[i].text,
            };
            if (isPdf) {
              meta.contentType = "pdf";
              if (pdfInfo) {
                meta.pageLabel = computePageLabel(
                  chunks[i].startOffset, chunks[i].startOffset + chunks[i].text.length,
                  pdfInfo.pageOffsets, pdfInfo.numPages,
                );
              }
            }
            keptMeta.push(meta);
            keptVectors.push(newEmbeddings[i]);
          }
        }
      }
    } else {
      delete checksums[filePath];
    }

    // Rebuild index
    const newDimension = keptVectors.length > 0 ? keptVectors[0].length : dimension;
    const newVectors = new Float32Array(keptMeta.length * newDimension);
    for (let i = 0; i < keptVectors.length; i++) {
      newVectors.set(keptVectors[i], i * newDimension);
    }

    const newIndex: RagIndex = {
      meta: keptMeta,
      dimension: newDimension,
      fileChecksums: checksums,
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
      chunkSize: ragSetting.chunkSize,
      chunkOverlap: ragSetting.chunkOverlap,
      chunkStrategy: ragSetting.chunkStrategy ?? "fixed",
    };

    this.entries.set(settingName, {
      index: newIndex,
      vectors: newVectors,
      loaded: true,
      incompatibleIndexLoaded: false,
    });

    await saveRagIndex(app, settingName, newIndex, newVectors);

    return { path: filePath, syncedAt: new Date().toISOString() };
  }

  /**
   * Search for similar chunks in a named setting's index
   */
  async search(
    settingName: string,
    query: string,
    ragSetting: RagSetting,
    llmConfig: LocalLlmConfig,
    app: App,
    fileExtensions?: string[],
  ): Promise<RagSearchResult[]> {
    const entry = await this.ensureLoaded(app, settingName, {
      externalIndexPath: ragSetting.externalIndexPath,
      sourceRagSettings: ragSetting.sourceRagSettings,
    });

    if (!entry.index || !entry.vectors || entry.index.meta.length === 0) {
      return [];
    }

    const { index, vectors } = entry;
    const queryEmbedding = await generateEmbedding(query, ragSetting, llmConfig);
    const queryVec = new Float32Array(queryEmbedding);
    const dim = index.dimension;
    const normalizedExtensions = new Set(
      (fileExtensions ?? [])
        .map(ext => ext.trim().toLowerCase().replace(/^\./, ""))
        .filter(ext => ext.length > 0)
    );

    // Compute cosine similarities
    const scores: { index: number; score: number }[] = [];
    for (let i = 0; i < index.meta.length; i++) {
      if (normalizedExtensions.size > 0) {
        const fileExt = index.meta[i].filePath.split(".").pop()?.toLowerCase() ?? "";
        if (!normalizedExtensions.has(fileExt)) continue;
      }
      const start = i * dim;
      const end = start + dim;
      if (end > vectors.length) break;
      const chunkVec = vectors.subarray(start, end);
      const score = cosineSimilarity(queryVec, chunkVec);
      scores.push({ index: i, score });
    }

    scores.sort((a, b) => b.score - a.score);
    const minScore = ragSetting.minScore ?? 0;
    const topK = scores
      .filter(s => s.score >= minScore)
      .slice(0, ragSetting.topK);

    // Compute headings at search time for markdown results (topK is small).
    // PDFs have no Markdown headings -> heading is omitted; pageLabel is used instead.
    // Read each unique markdown source file once, then resolve the nearest heading
    // per chunk from the full document content + the chunk's startOffset.
    const markdownPaths = new Set<string>();
    for (const { index: idx } of topK) {
      const meta = index.meta[idx];
      if (!meta.contentType && !meta.pageLabel) {
        markdownPaths.add(meta.filePath);
      }
    }
    const contentByFile = new Map<string, string>();
    for (const filePath of markdownPaths) {
      try {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const content = await app.vault.cachedRead(file);
          contentByFile.set(filePath, content);
        }
      } catch {
        // File read failed — heading falls back to undefined (chip shows filename only).
      }
    }

    return topK.map(({ index: idx, score }) => {
      const meta = index.meta[idx];
      const isPdf = !!meta.contentType || !!meta.pageLabel;
      let heading: string | undefined;
      if (!isPdf && contentByFile.has(meta.filePath)) {
        const fullContent = contentByFile.get(meta.filePath)!;
        heading = findNearestHeading(fullContent, meta.startOffset);
      }
      return {
        text: meta.text,
        filePath: meta.filePath,
        score,
        startOffset: meta.startOffset,
        ...(!isPdf && heading !== undefined && heading !== "" ? { heading } : {}),
        ...(meta.contentType && { contentType: meta.contentType }),
        ...(meta.pageLabel && { pageLabel: meta.pageLabel }),
      };
    });
  }

  /** Return indexed files with per-file chunk counts, sorted by file path. */
  async getIndexedFiles(app: App, settingName: string): Promise<{ filePath: string; chunks: number }[]> {
    const entry = await this.ensureLoaded(app, settingName);
    if (!entry.index) return [];
    const counts = new Map<string, number>();
    for (const filePath of Object.keys(entry.index.fileChecksums ?? {})) {
      counts.set(filePath, 0);
    }
    for (const m of entry.index.meta) {
      counts.set(m.filePath, (counts.get(m.filePath) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([filePath, chunks]) => ({ filePath, chunks }))
      .sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  /** Keyword search across indexed chunks (no embedding API call needed). */
  async keywordSearch(
    app: App, settingName: string, query: string, topK: number, fileExtensions?: string[],
  ): Promise<RagSearchResult[]> {
    const entry = await this.ensureLoaded(app, settingName);
    if (!entry.index) return [];

    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (terms.length === 0) return [];
    const normalizedExtensions = new Set(
      (fileExtensions ?? [])
        .map(ext => ext.trim().toLowerCase().replace(/^\./, ""))
        .filter(ext => ext.length > 0)
    );

    const scored: { index: number; score: number }[] = [];

    for (let i = 0; i < entry.index.meta.length; i++) {
      const meta = entry.index.meta[i];
      if (normalizedExtensions.size > 0) {
        const fileExt = meta.filePath.split(".").pop()?.toLowerCase() ?? "";
        if (!normalizedExtensions.has(fileExt)) continue;
      }
      const textLower = meta.text.toLowerCase();
      let matchCount = 0;
      let totalOccurrences = 0;
      for (const term of terms) {
        let pos = 0;
        let found = false;
        while (true) {
          const idx = textLower.indexOf(term, pos);
          if (idx === -1) break;
          found = true;
          totalOccurrences++;
          pos = idx + term.length;
        }
        if (found) matchCount++;
      }

      if (matchCount === 0) continue;

      const termCoverage = matchCount / terms.length;
      const density = totalOccurrences / (textLower.length / 100);
      scored.push({ index: i, score: termCoverage * 0.7 + Math.min(density, 1) * 0.3 });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(r => {
      const meta = entry.index!.meta[r.index];
      return {
        filePath: meta.filePath,
        text: meta.text,
        score: r.score,
        startOffset: meta.startOffset,
        ...(meta.contentType && { contentType: meta.contentType }),
        ...(meta.pageLabel && { pageLabel: meta.pageLabel }),
      };
    });
  }

  /** Get an adjacent chunk (prev/next) for a given file.
   *  Uses text matching to identify the current chunk. */
  async getAdjacentChunk(
    app: App, settingName: string, filePath: string, chunkText: string, direction: "prev" | "next",
  ): Promise<RagSearchResult | null> {
    const entry = await this.ensureLoaded(app, settingName);
    if (!entry.index) return null;

    const fileChunks: { meta: ChunkMeta; metaIndex: number }[] = [];
    for (let i = 0; i < entry.index.meta.length; i++) {
      if (entry.index.meta[i].filePath === filePath) {
        fileChunks.push({ meta: entry.index.meta[i], metaIndex: i });
      }
    }

    const currentPos = fileChunks.findIndex(c => c.meta.text === chunkText);
    if (currentPos === -1) return null;

    const targetPos = direction === "prev" ? currentPos - 1 : currentPos + 1;
    if (targetPos < 0 || targetPos >= fileChunks.length) return null;

    const meta = fileChunks[targetPos].meta;
    return {
      filePath: meta.filePath,
      text: meta.text,
      score: 0,
      startOffset: meta.startOffset,
      ...(meta.contentType && { contentType: meta.contentType }),
      ...(meta.pageLabel && { pageLabel: meta.pageLabel }),
    };
  }

  /**
   * Clear the entire RAG index for a named setting
   */
  async clear(app: App, settingName: string): Promise<void> {
    this.entries.delete(settingName);
    await deleteRagIndex(app, settingName);
  }

  private async ensureLoaded(
    app: App,
    settingName: string,
    options?: LoadOptions,
  ): Promise<StoreEntry> {
    if (options?.externalIndexPath !== undefined) {
      if (options.externalIndexPath) {
        this.externalPaths.set(settingName, options.externalIndexPath);
      } else {
        this.externalPaths.delete(settingName);
      }
    }
    if (options?.sourceRagSettings !== undefined) {
      this.setSourceRagSettings(settingName, options.sourceRagSettings);
    }
    const existing = this.entries.get(settingName);
    if (existing?.loaded) {
      return existing;
    }

    const externalPath = this.externalPaths.get(settingName);
    const externalPaths = externalPath ? parseExternalIndexPaths(externalPath) : [];
    const sourceNames = this.sourceRagSettings.get(settingName) ?? [];
    let index: RagIndex | null = null;
    let vectors: Float32Array | null = null;
    let incompatibleIndexLoaded = false;

    if (sourceNames.length > 0) {
      const loadedIndexes: { index: RagIndex; vectors: Float32Array }[] = [];
      for (const sourceName of sourceNames) {
        const sourceEntry = await this.ensureLoaded(app, sourceName);
        if (!sourceEntry.index || !sourceEntry.vectors || sourceEntry.index.meta.length === 0) continue;
        loadedIndexes.push({ index: sourceEntry.index, vectors: sourceEntry.vectors });
      }
      ({ index, vectors } = mergeLoadedIndexes(loadedIndexes));
    } else if (externalPath) {
      const loadedIndexes: { index: RagIndex; vectors: Float32Array }[] = [];
      for (const path of externalPaths) {
        const externalIndex = await loadExternalRagIndex(path);
        if (!externalIndex || externalIndex.meta.length === 0) continue;
        if (externalIndex.dimension <= 0) continue;
        const externalVectors = await loadExternalRagVectors(path);
        if (!externalVectors) continue;
        if (externalVectors.length < externalIndex.meta.length * externalIndex.dimension) continue;
        loadedIndexes.push({ index: externalIndex, vectors: externalVectors });
      }

      ({ index, vectors } = mergeLoadedIndexes(loadedIndexes));
    } else {
      index = await loadRagIndex(app, settingName);
      if (index) {
        if (index.embeddingFormatVersion === EMBEDDING_FORMAT_VERSION) {
          vectors = await loadRagVectors(app, settingName);
        } else {
          index = null;
          incompatibleIndexLoaded = true;
        }
      }
    }

    const entry: StoreEntry = { index, vectors, loaded: true, incompatibleIndexLoaded };
    this.entries.set(settingName, entry);
    return entry;
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

interface PdfExtractResult {
  text: string;
  numPages: number;
  /** Character offset where each page starts. pageOffsets[i] = offset of page i+1. */
  pageOffsets: number[];
}

interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
}

interface PdfJsPage {
  getTextContent(): Promise<PdfJsTextContent>;
}

interface PdfJsTextContent {
  items: PdfJsTextItem[];
}

interface PdfJsTextItem {
  str?: unknown;
}

interface PdfJsLib {
  getDocument(source: { data: ArrayBuffer }): { promise: Promise<PdfJsDocument> };
}

/**
 * Extract text from a PDF file using Obsidian's built-in PDF.js.
 * Returns null if the PDF has no extractable text (e.g. scanned/image-only).
 * Throws on read/parse errors so callers can preserve existing index data.
 */
async function extractPdfText(app: App, file: TFile): Promise<PdfExtractResult | null> {
  const buffer = await app.vault.readBinary(file);
  const pdfjsLib = await loadPdfJs() as PdfJsLib;
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => typeof item.str === "string" ? item.str : "").join(" ");
    pageTexts.push(text.trim() ? text : "");
  }
  // Build joined text with page offset tracking
  const parts: string[] = [];
  const pageOffsets: number[] = [];
  let offset = 0;
  for (let i = 0; i < pageTexts.length; i++) {
    if (pageTexts[i]) {
      if (parts.length > 0) offset++; // for "\n" separator
      pageOffsets.push(offset);
      parts.push(pageTexts[i]);
      offset += pageTexts[i].length;
    } else {
      // Empty page: point to where next text will start
      pageOffsets.push(offset);
    }
  }
  if (parts.length === 0) return null;
  return { text: parts.join("\n"), numPages: pdf.numPages, pageOffsets };
}

/**
 * Compute a page label (e.g. "pages 2-5 of 24") for a chunk based on its offset and length.
 */
function computePageLabel(startOffset: number, endOffset: number, pageOffsets: number[], numPages: number): string {
  let startPage = 1;
  let endPage = 1;
  for (let i = 0; i < pageOffsets.length; i++) {
    if (pageOffsets[i] <= startOffset) startPage = i + 1;
    if (pageOffsets[i] <= endOffset) endPage = i + 1;
  }
  return `pages ${startPage}-${endPage} of ${numPages}`;
}

function getTargetFiles(app: App, ragSetting: RagSetting): TFile[] {
  const files = app.vault.getFiles().filter(f => f.extension === "md" || f.extension === "pdf");
  const excludeRegexes = ragSetting.excludePatterns
    .filter(Boolean)
    .flatMap(p => {
      try { return [new RegExp(p)]; } catch { return []; }
    });

  return files.filter(file => {
    // Skip workspace folder
    if (file.path.startsWith(WORKSPACE_FOLDER + "/")) return false;

    // Check target folders
    if (ragSetting.targetFolders.length > 0) {
      const inTarget = ragSetting.targetFolders.some(folder =>
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

    const chunkStr = text.slice(start, end).trim();
    if (chunkStr) {
      chunks.push({ text: chunkStr, startOffset: start });
    }

    start = end - chunkOverlap;
    if (start <= chunks[chunks.length - 1]?.startOffset) {
      start = end; // Prevent infinite loop
    }
  }

  return chunks;
}

/**
 * Split text into chunks on sentence terminators (English ". " and Chinese "。"),
 * accumulating sentences until adding the next would exceed chunkSize.
 * Falls back to a single chunk when no terminators are present.
 * Each chunk records its startOffset in the original text.
 */
export function chunkBySentence(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): { text: string; startOffset: number }[] {
  const chunks: { text: string; startOffset: number }[] = [];
  if (text.length === 0) return chunks;

  // Find all sentence boundary end indices (index just past the terminator).
  const terminatorPattern = /[。.]\s*/g;
  const boundaries: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = terminatorPattern.exec(text)) !== null) {
    boundaries.push(match.index + match[0].length);
  }

  // No terminators -> single chunk (even if it exceeds chunkSize)
  if (boundaries.length === 0) {
    const trimmed = text.trim();
    if (trimmed) chunks.push({ text: trimmed, startOffset: 0 });
    return chunks;
  }

  // Build sentence spans [start, end) using boundaries.
  const spans: { start: number; end: number }[] = [];
  let prevEnd = 0;
  for (const end of boundaries) {
    spans.push({ start: prevEnd, end });
    prevEnd = end;
  }
  // Trailing text after the last terminator
  if (prevEnd < text.length) {
    spans.push({ start: prevEnd, end: text.length });
  }

  let chunkStart = 0;
  let spanIdx = 0;

  while (chunkStart < text.length) {
    // Advance spanIdx to the first span ending after chunkStart.
    while (spanIdx < spans.length && spans[spanIdx].end <= chunkStart) {
      spanIdx++;
    }
    if (spanIdx >= spans.length) break;

    // Greedily accumulate whole sentences starting from chunkStart.
    let accEnd = spans[spanIdx].end;
    let j = spanIdx + 1;
    while (j < spans.length && accEnd - chunkStart + (spans[j].end - spans[j].start) <= chunkSize) {
      accEnd = spans[j].end;
      j++;
    }

    const chunkStr = text.slice(chunkStart, accEnd).trim();
    if (chunkStr) {
      chunks.push({ text: chunkStr, startOffset: chunkStart });
    }

    if (accEnd >= text.length) break;

    // Overlap: step back by chunkOverlap chars (character-level; may start mid-sentence).
    let nextStart = accEnd - chunkOverlap;
    // Guarantee forward progress; if overlap would not advance, jump to accEnd.
    if (nextStart <= chunkStart) {
      nextStart = accEnd;
    }
    chunkStart = nextStart;
  }

  return chunks;
}

/**
 * Split text into chunks by Obsidian blocks (text wrapped by blank lines).
 * - At the default chunk size (>= 1000, matching DEFAULT_RAG_SETTING.chunkSize),
 *   each non-empty block becomes its own chunk (block-level granularity); blocks
 *   are not merged across blank lines.
 * - At smaller chunk sizes, consecutive small blocks are greedily merged into one
 *   chunk until adding the next would exceed chunkSize. Only whole blocks are
 *   concatenated (joined by "\n\n"); a block is never split to merge with a
 *   different logical block's interior.
 * - A block more than twice the chunk size is re-chunked with chunkBySentence,
 *   falling back to chunkText when the block has no sentence terminators.
 *   Sub-chunks inherit offsets relative to the original text. Slightly-oversized
 *   blocks are kept whole to preserve block boundaries.
 * Each chunk records its startOffset in the original text.
 */
export function chunkByBlock(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): { text: string; startOffset: number }[] {
  const chunks: { text: string; startOffset: number }[] = [];
  if (text.length === 0) return chunks;

  // Split on blank lines, tracking each block's startOffset.
  const blockPattern = /\n\s*\n/g;
  const blocks: { text: string; startOffset: number }[] = [];
  let prevEnd = 0;
  let match: RegExpExecArray | null;
  const indices: number[] = [];
  while ((match = blockPattern.exec(text)) !== null) {
    indices.push(match.index);
  }
  for (const splitIndex of indices) {
    const blockText = text.slice(prevEnd, splitIndex);
    if (blockText.length > 0) blocks.push({ text: blockText, startOffset: prevEnd });
    // Advance past the blank-line separator
    const sepMatch = /\n\s*\n/.exec(text.slice(splitIndex));
    prevEnd = splitIndex + (sepMatch ? sepMatch[0].length : 0);
  }
  // Trailing block
  if (prevEnd < text.length) {
    blocks.push({ text: text.slice(prevEnd), startOffset: prevEnd });
  }

  if (blocks.length === 0) return chunks;

  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    const blockTrimmed = block.text.trim();

    if (blockTrimmed.length === 0) {
      i++;
      continue;
    }

    // Large block: re-chunk it (sentence first, then fixed fallback).
    // Only re-split when the block is more than twice the chunk size, so
    // slightly-oversized blocks stay whole and preserve block boundaries.
    if (blockTrimmed.length > chunkSize * 2) {
      const hasTerminator = /[。.]\s/.test(block.text) || /[。]/.test(block.text);
      const sub = hasTerminator
        ? chunkBySentence(block.text, chunkSize, chunkOverlap)
        : chunkText(block.text, chunkSize, chunkOverlap);
      for (const s of sub) {
        const sTrimmed = s.text.trim();
        if (sTrimmed) {
          chunks.push({ text: sTrimmed, startOffset: block.startOffset + s.startOffset });
        }
      }
      i++;
      continue;
    }

    // At the default chunk size (1000, matching DEFAULT_RAG_SETTING.chunkSize),
    // keep each block as its own chunk; smaller sizes pack consecutive blocks.
    if (chunkSize >= 1000) {
      chunks.push({ text: blockTrimmed, startOffset: block.startOffset });
      i++;
      continue;
    }

    // Small block: greedily merge consecutive blocks within budget
    let accText = block.text;
    const accStart = block.startOffset;
    let j = i + 1;
    while (j < blocks.length) {
      const next = blocks[j];
      const nextTrimmed = next.text.trim();
      if (nextTrimmed.length === 0) { j++; continue; }
      // Oversized block encountered while accumulating -> stop merging
      if (nextTrimmed.length > chunkSize) break;
      const candidate = accText + "\n\n" + next.text;
      if (candidate.length > chunkSize) break;
      accText = candidate;
      j++;
    }

    const accTrimmed = accText.trim();
    if (accTrimmed) {
      chunks.push({ text: accTrimmed, startOffset: accStart });
    }
    i = j;
  }

  return chunks;
}

/**
 * Dispatch chunking based on the RagSetting's chunkStrategy.
 * Falls back to the fixed `chunkText` strategy for unknown/missing values.
 */
export function chunkContent(
  content: string,
  ragSetting: RagSetting,
): { text: string; startOffset: number }[] {
  switch (ragSetting.chunkStrategy ?? "fixed") {
    case "sentence":
      return chunkBySentence(content, ragSetting.chunkSize, ragSetting.chunkOverlap);
    case "block":
      return chunkByBlock(content, ragSetting.chunkSize, ragSetting.chunkOverlap);
    default:
      return chunkText(content, ragSetting.chunkSize, ragSetting.chunkOverlap);
  }
}

export function simpleChecksum(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

export function simpleChecksumBytes(buffer: ArrayBuffer): string {
  let hash = 0;
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    hash = ((hash << 5) - hash) + byte;
    hash |= 0;
  }
  return hash.toString(36);
}

async function fileChecksum(app: App, file: TFile): Promise<string> {
  if (file.extension === "pdf") {
    const buffer = await app.vault.readBinary(file);
    return `pdf:${simpleChecksumBytes(buffer)}`;
  }
  return simpleChecksum(await app.vault.cachedRead(file));
}

/**
 * Find the nearest Markdown heading before a given offset.
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
