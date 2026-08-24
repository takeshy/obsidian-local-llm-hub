import type { DataAdapter } from "obsidian";

/** Ensure a vault-relative folder exists, including folders hidden from Obsidian's index. */
export async function ensureAdapterFolder(adapter: DataAdapter, folderPath: string): Promise<void> {
  const normalized = folderPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || await adapter.exists(normalized)) return;

  const separatorIndex = normalized.lastIndexOf("/");
  const parent = separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : "";
  if (parent) await ensureAdapterFolder(adapter, parent);

  try {
    await adapter.mkdir(normalized);
  } catch (error) {
    // Another operation may have created the folder after the existence check.
    if (!(await adapter.exists(normalized))) throw error;
  }
}
