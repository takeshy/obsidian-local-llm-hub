/**
 * RAG Storage
 * Persists vector embeddings as Float32Array binary files
 * with JSON metadata sidecar, per named setting
 */

import type { App } from "obsidian";
import { WORKSPACE_FOLDER } from "../types";
import type { ChunkStrategy } from "../types";

export interface ChunkMeta {
  filePath: string;
  startOffset: number;
  text: string;
  contentType?: string; // "pdf" for PDF-origin chunks; undefined for markdown
  pageLabel?: string;   // PDF page range (e.g. "pages 1-6 of 24")
}

export interface RagIndex {
  meta: ChunkMeta[];
  dimension: number;
  fileChecksums: Record<string, string>; // filePath -> checksum
  embeddingFormatVersion?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  chunkStrategy?: ChunkStrategy;
}

interface ExternalChunkMeta {
  file_path?: unknown;
  start_offset?: unknown;
  startOffset?: unknown;
  text?: unknown;
}

interface ExternalRagIndex {
  meta?: ExternalChunkMeta[];
}

const RAG_DIR = `${WORKSPACE_FOLDER}/rag`;
const META_FILE = "rag-index.json";
const VECTORS_FILE = "rag-vectors.bin";

export function sanitizeSettingName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getNodeRequire(): ((id: string) => unknown) | null {
  const runtimeWindow = activeWindow as unknown as {
    require?: (id: string) => unknown;
    module?: { require?: (id: string) => unknown };
  };
  const loader =
    runtimeWindow.require ||
    runtimeWindow.module?.require;
  return loader || null;
}

function getSettingDir(settingName: string): string {
  return `${RAG_DIR}/${sanitizeSettingName(settingName)}`;
}

function getIndexPath(settingName: string): string {
  return `${getSettingDir(settingName)}/${META_FILE}`;
}

function getVectorsPath(settingName: string): string {
  return `${getSettingDir(settingName)}/${VECTORS_FILE}`;
}

async function ensureDir(app: App, dirPath: string): Promise<void> {
  for (const seg of [WORKSPACE_FOLDER, RAG_DIR, dirPath]) {
    if (!(await app.vault.adapter.exists(seg))) {
      await app.vault.createFolder(seg);
    }
  }
}

/**
 * Save RAG index to vault (per setting name)
 */
export async function saveRagIndex(
  app: App,
  settingName: string,
  index: RagIndex,
  vectors: Float32Array,
): Promise<void> {
  const dirPath = getSettingDir(settingName);
  await ensureDir(app, dirPath);

  const indexPath = getIndexPath(settingName);
  await app.vault.adapter.write(indexPath, JSON.stringify(index));

  const vectorsPath = getVectorsPath(settingName);
  const bytes = new Uint8Array(vectors.byteLength);
  bytes.set(new Uint8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength));
  await app.vault.adapter.writeBinary(vectorsPath, bytes.buffer);
}

/**
 * Load RAG index from vault (per setting name)
 */
export async function loadRagIndex(
  app: App,
  settingName: string,
): Promise<RagIndex | null> {
  const indexPath = getIndexPath(settingName);
  try {
    if (!(await app.vault.adapter.exists(indexPath))) return null;
    const content = await app.vault.adapter.read(indexPath);
    return JSON.parse(content) as RagIndex;
  } catch {
    return null;
  }
}

/**
 * Load RAG vectors from vault (per setting name)
 */
export async function loadRagVectors(
  app: App,
  settingName: string,
): Promise<Float32Array | null> {
  const vectorsPath = getVectorsPath(settingName);
  try {
    if (!(await app.vault.adapter.exists(vectorsPath))) return null;
    const buffer = await app.vault.adapter.readBinary(vectorsPath);
    return new Float32Array(buffer);
  } catch {
    return null;
  }
}

/**
 * Delete RAG index from vault (per setting name)
 */
export async function deleteRagIndex(
  app: App,
  settingName: string,
): Promise<void> {
  const dirPath = getSettingDir(settingName);
  const indexPath = getIndexPath(settingName);
  const vectorsPath = getVectorsPath(settingName);
  try {
    if (await app.vault.adapter.exists(indexPath)) {
      await app.vault.adapter.remove(indexPath);
    }
    if (await app.vault.adapter.exists(vectorsPath)) {
      await app.vault.adapter.remove(vectorsPath);
    }
    if (await app.vault.adapter.exists(dirPath)) {
      await app.vault.adapter.rmdir(dirPath, true);
    }
  } catch {
    // Ignore deletion errors
  }
}

/**
 * Rename RAG index directory from old setting name to new setting name.
 * Copies files to new directory and removes old directory.
 */
export async function renameRagIndex(
  app: App,
  oldSettingName: string,
  newSettingName: string,
): Promise<void> {
  const oldDir = getSettingDir(oldSettingName);
  const newDir = getSettingDir(newSettingName);
  const oldIndex = getIndexPath(oldSettingName);
  const oldVectors = getVectorsPath(oldSettingName);

  try {
    if (!(await app.vault.adapter.exists(oldIndex))) return;

    await ensureDir(app, newDir);

    // Copy index
    const indexContent = await app.vault.adapter.read(oldIndex);
    await app.vault.adapter.write(getIndexPath(newSettingName), indexContent);

    // Copy vectors
    if (await app.vault.adapter.exists(oldVectors)) {
      const vectorBuffer = await app.vault.adapter.readBinary(oldVectors);
      await app.vault.adapter.writeBinary(getVectorsPath(newSettingName), vectorBuffer);
    }

    // Remove old
    await app.vault.adapter.remove(oldIndex);
    if (await app.vault.adapter.exists(oldVectors)) {
      await app.vault.adapter.remove(oldVectors);
    }
    if (await app.vault.adapter.exists(oldDir)) {
      await app.vault.adapter.rmdir(oldDir, true);
    }
  } catch {
    // Best-effort rename
  }
}

/**
 * Migrate old flat storage (LocalLlmHub/rag/rag-index.json) to named setting directory.
 * Returns true if migration was performed.
 */
export async function migrateOldRagIndex(
  app: App,
  settingName: string,
): Promise<boolean> {
  const oldIndexPath = `${RAG_DIR}/${META_FILE}`;
  const oldVectorsPath = `${RAG_DIR}/${VECTORS_FILE}`;
  try {
    if (!(await app.vault.adapter.exists(oldIndexPath))) return false;

    const dirPath = getSettingDir(settingName);
    await ensureDir(app, dirPath);

    // Copy old files to new location
    const indexContent = await app.vault.adapter.read(oldIndexPath);
    await app.vault.adapter.write(getIndexPath(settingName), indexContent);

    if (await app.vault.adapter.exists(oldVectorsPath)) {
      const vectorBuffer = await app.vault.adapter.readBinary(oldVectorsPath);
      await app.vault.adapter.writeBinary(getVectorsPath(settingName), vectorBuffer);
    }

    // Remove old files
    await app.vault.adapter.remove(oldIndexPath);
    if (await app.vault.adapter.exists(oldVectorsPath)) {
      await app.vault.adapter.remove(oldVectorsPath);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Load RAG index from an external (absolute) directory path using Node.js fs.
 */
export async function loadExternalRagIndex(dirPath: string): Promise<RagIndex | null> {
  try {
    const loader = getNodeRequire();
    const fs = loader?.("fs") as { promises: { readFile: (p: string, e: string) => Promise<string> } } | undefined;
    const path = loader?.("path") as { join: (...args: string[]) => string } | undefined;
    if (!fs || !path) return null;
    const content = await fs.promises.readFile(path.join(dirPath, META_FILE), "utf-8");
    const raw = JSON.parse(content) as ExternalRagIndex & Partial<RagIndex>;

    // Normalize external index meta fields (e.g. file_path -> filePath, start_offset -> startOffset)
    if (raw.meta && raw.meta.length > 0 && !("filePath" in raw.meta[0]) && ("file_path" in raw.meta[0])) {
      raw.meta = raw.meta.map((m) => ({
        ...m,
        filePath: typeof m.file_path === "string" ? m.file_path : "",
        startOffset: typeof m.start_offset === "number"
          ? m.start_offset
          : typeof m.startOffset === "number" ? m.startOffset : 0,
        text: typeof m.text === "string" ? m.text : "",
      }));
    }

    return raw as RagIndex;
  } catch {
    return null;
  }
}

/**
 * Load RAG vectors from an external (absolute) directory path using Node.js fs.
 */
export async function loadExternalRagVectors(dirPath: string): Promise<Float32Array | null> {
  try {
    const loader = getNodeRequire();
    const fs = loader?.("fs") as { promises: { readFile: (p: string) => Promise<Buffer> } } | undefined;
    const path = loader?.("path") as { join: (...args: string[]) => string } | undefined;
    if (!fs || !path) return null;
    const buffer = await fs.promises.readFile(path.join(dirPath, VECTORS_FILE));
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  } catch {
    return null;
  }
}
