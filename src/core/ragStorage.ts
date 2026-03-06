/**
 * RAG Storage
 * Persists vector embeddings as Float32Array binary files
 * with JSON metadata sidecar
 */

import type { App } from "obsidian";

export interface ChunkMeta {
  filePath: string;
  startOffset: number;
  text: string;
}

export interface RagIndex {
  meta: ChunkMeta[];
  dimension: number;
  fileChecksums: Record<string, string>; // filePath -> checksum
}

const META_FILE = "rag-index.json";
const VECTORS_FILE = "rag-vectors.bin";

/**
 * Save RAG index to vault
 */
export async function saveRagIndex(
  app: App,
  workspaceFolder: string,
  index: RagIndex,
  vectors: Float32Array,
): Promise<void> {
  const folder = `${workspaceFolder}/rag`;

  // Ensure folder exists
  if (!app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder);
  }

  // Save metadata as JSON
  const metaPath = `${folder}/${META_FILE}`;
  const metaJson = JSON.stringify(index);
  const existingMeta = app.vault.getAbstractFileByPath(metaPath);
  if (existingMeta) {
    await app.vault.adapter.write(metaPath, metaJson);
  } else {
    await app.vault.create(metaPath, metaJson);
  }

  // Save vectors as binary
  const vectorsPath = `${folder}/${VECTORS_FILE}`;
  const buffer = vectors.buffer.slice(
    vectors.byteOffset,
    vectors.byteOffset + vectors.byteLength,
  );
  await app.vault.adapter.writeBinary(vectorsPath, buffer as ArrayBuffer);
}

/**
 * Load RAG index from vault
 */
export async function loadRagIndex(
  app: App,
  workspaceFolder: string,
): Promise<{ index: RagIndex; vectors: Float32Array } | null> {
  const folder = `${workspaceFolder}/rag`;
  const metaPath = `${folder}/${META_FILE}`;
  const vectorsPath = `${folder}/${VECTORS_FILE}`;

  try {
    const metaContent = await app.vault.adapter.read(metaPath);
    const index = JSON.parse(metaContent) as RagIndex;

    const vectorBuffer = await app.vault.adapter.readBinary(vectorsPath);
    const vectors = new Float32Array(vectorBuffer);

    return { index, vectors };
  } catch {
    return null;
  }
}

/**
 * Delete RAG index from vault
 */
export async function deleteRagIndex(
  app: App,
  workspaceFolder: string,
): Promise<void> {
  const folder = `${workspaceFolder}/rag`;

  for (const fileName of [META_FILE, VECTORS_FILE]) {
    const path = `${folder}/${fileName}`;
    const file = app.vault.getAbstractFileByPath(path);
    if (file) {
      await app.fileManager.trashFile(file);
    }
  }
}
