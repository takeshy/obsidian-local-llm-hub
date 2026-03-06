import { App, TFile } from "obsidian";
import * as Diff from "diff";
import type { EditHistorySettings } from "src/types";
import {
  getHistoryFromStore,
  saveHistoryToStore,
  deleteHistoryFromStore,
  getAllHistoryPaths,
  clearAllHistories,
  getSnapshotFromStore,
  saveSnapshotToStore,
  deleteSnapshotFromStore,
} from "./editHistoryStore";
import { applyDiff } from "./diffUtils";

export interface EditHistoryEntry {
  id: string;
  timestamp: string;
  source: "workflow" | "propose_edit" | "manual" | "auto";
  workflowName?: string;
  model?: string;
  diff: string;
  stats: {
    additions: number;
    deletions: number;
  };
}

export interface EditHistoryFile {
  version: number;
  path: string;
  entries: EditHistoryEntry[];
}

export interface EditHistoryStats {
  totalFiles: number;
  totalEntries: number;
}

export class EditHistoryManager {
  private app: App;
  private settings: EditHistorySettings;

  constructor(app: App, settings: EditHistorySettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: EditHistorySettings): void {
    this.settings = settings;
  }

  isEnabled(): boolean {
    return this.settings.enabled;
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 8);
  }

  private loadHistoryFile(notePath: string): EditHistoryFile {
    return getHistoryFromStore(notePath) ?? {
      version: 1,
      path: notePath,
      entries: [],
    };
  }

  private saveHistoryFile(notePath: string, history: EditHistoryFile): void {
    saveHistoryToStore(notePath, history);
  }

  private loadSnapshot(notePath: string): string | null {
    return getSnapshotFromStore(notePath);
  }

  private saveSnapshot(notePath: string, content: string): void {
    saveSnapshotToStore(notePath, content);
  }

  getSnapshot(path: string): string | null {
    return this.loadSnapshot(path);
  }

  setSnapshot(path: string, content: string): void {
    this.saveSnapshot(path, content);
  }

  private createDiff(originalContent: string, modifiedContent: string): { diff: string; stats: { additions: number; deletions: number } } {
    const contextLines = this.settings.diff.contextLines;

    const patch = Diff.structuredPatch(
      "original",
      "modified",
      originalContent,
      modifiedContent,
      undefined,
      undefined,
      { context: contextLines }
    );

    const lines: string[] = [];
    let additions = 0;
    let deletions = 0;

    for (const hunk of patch.hunks) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);

      for (const line of hunk.lines) {
        lines.push(line);
        if (line.startsWith("+") && !line.startsWith("+++")) {
          additions++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          deletions++;
        }
      }
    }

    return {
      diff: lines.join("\n"),
      stats: { additions, deletions },
    };
  }

  saveEdit(params: {
    path: string;
    modifiedContent: string;
    source: "workflow" | "propose_edit" | "manual" | "auto";
    workflowName?: string;
    model?: string;
  }): EditHistoryEntry | null {
    if (!this.settings.enabled) {
      return null;
    }

    const snapshot = this.loadSnapshot(params.path) ?? "";
    const { diff, stats } = this.createDiff(params.modifiedContent, snapshot);

    if (stats.additions === 0 && stats.deletions === 0) {
      return null;
    }

    const entry: EditHistoryEntry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      source: params.source,
      workflowName: params.workflowName,
      model: params.model,
      diff,
      stats,
    };

    const history = this.loadHistoryFile(params.path);
    history.entries.push(entry);

    this.saveHistoryFile(params.path, history);
    this.saveSnapshot(params.path, params.modifiedContent);

    return entry;
  }

  getHistory(path: string): EditHistoryEntry[] {
    const snapshotExists = this.loadSnapshot(path) !== null;
    const historyData = getHistoryFromStore(path);

    if (historyData && !snapshotExists) {
      deleteHistoryFromStore(path);
      return [];
    }

    const history = this.loadHistoryFile(path);
    return history.entries;
  }

  async getDiffFromLastSaved(path: string): Promise<{ diff: string; stats: { additions: number; deletions: number } } | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return null;
    }

    const snapshot = this.loadSnapshot(path);
    if (snapshot === null) {
      return null;
    }

    const currentContent = await this.app.vault.read(file);

    if (currentContent === snapshot) {
      return { diff: "", stats: { additions: 0, deletions: 0 } };
    }

    return this.createDiff(snapshot, currentContent);
  }

  getContentAt(path: string, entryId: string): string | null {
    const snapshot = this.loadSnapshot(path);
    if (snapshot === null) {
      return null;
    }

    const history = this.loadHistoryFile(path);
    const targetIndex = history.entries.findIndex(e => e.id === entryId);
    if (targetIndex === -1) {
      return null;
    }

    let content = snapshot;
    for (let i = history.entries.length - 1; i >= targetIndex; i--) {
      content = applyDiff(content, history.entries[i].diff);
    }

    return content;
  }

  async restoreTo(path: string, entryId: string): Promise<boolean> {
    const content = this.getContentAt(path, entryId);
    if (content === null) {
      return false;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return false;
    }

    await this.app.vault.modify(file, content);
    this.saveSnapshot(path, content);
    this.clearHistory(path);

    return true;
  }

  async revertToBase(path: string): Promise<boolean> {
    const snapshot = this.loadSnapshot(path);
    if (snapshot === null) {
      return false;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return false;
    }

    await this.app.vault.modify(file, snapshot);
    return true;
  }

  async initSnapshot(path: string): Promise<void> {
    if (!this.settings.enabled) {
      return;
    }

    if (!path.endsWith(".md")) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return;
    }

    const currentContent = await this.app.vault.read(file);
    const existingSnapshot = this.loadSnapshot(path);

    if (existingSnapshot === null) {
      this.saveSnapshot(path, currentContent);
      return;
    }

    if (existingSnapshot === currentContent) {
      return;
    }

    this.saveEdit({
      path,
      modifiedContent: currentContent,
      source: "auto",
    });
  }

  async saveManualSnapshot(path: string): Promise<EditHistoryEntry | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return null;
    }

    const currentContent = await this.app.vault.read(file);

    return this.saveEdit({
      path,
      modifiedContent: currentContent,
      source: "manual",
    });
  }

  async ensureSnapshot(path: string): Promise<string | null> {
    if (!this.settings.enabled) {
      return null;
    }

    if (!path.endsWith(".md")) {
      return null;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return null;
    }

    const currentContent = await this.app.vault.read(file);
    const existingSnapshot = this.loadSnapshot(path);

    if (existingSnapshot === null) {
      this.saveSnapshot(path, currentContent);
      return currentContent;
    }

    if (existingSnapshot === currentContent) {
      return null;
    }

    const { diff, stats } = this.createDiff(currentContent, existingSnapshot);

    if (stats.additions > 0 || stats.deletions > 0) {
      const entry: EditHistoryEntry = {
        id: this.generateId(),
        timestamp: new Date().toISOString(),
        source: "auto",
        diff,
        stats,
      };

      const history = this.loadHistoryFile(path);
      history.entries.push(entry);
      this.saveHistoryFile(path, history);
    }

    this.saveSnapshot(path, currentContent);
    return currentContent;
  }

  deleteEntry(path: string, entryId: string): void {
    const history = this.loadHistoryFile(path);
    const index = history.entries.findIndex(e => e.id === entryId);
    if (index !== -1) {
      history.entries.splice(index, 1);
      this.saveHistoryFile(path, history);
    }
  }

  clearHistory(path: string): void {
    deleteHistoryFromStore(path);
  }

  clearSnapshot(path: string): void {
    deleteSnapshotFromStore(path);
  }

  clearAllHistory(): number {
    const paths = getAllHistoryPaths();
    const count = paths.length;
    clearAllHistories();
    return count;
  }

  getStats(): EditHistoryStats {
    let totalFiles = 0;
    let totalEntries = 0;

    const paths = getAllHistoryPaths();

    for (const path of paths) {
      const history = getHistoryFromStore(path);
      if (!history) continue;
      totalFiles++;
      totalEntries += history.entries.length;
    }

    return { totalFiles, totalEntries };
  }

  handleFileRename(oldPath: string, newPath: string): void {
    const history = getHistoryFromStore(oldPath);
    if (history) {
      history.path = newPath;
      saveHistoryToStore(newPath, history);
      deleteHistoryFromStore(oldPath);
    }

    const snapshot = getSnapshotFromStore(oldPath);
    if (snapshot !== null) {
      saveSnapshotToStore(newPath, snapshot);
      deleteSnapshotFromStore(oldPath);
    }
  }

  handleFileDelete(path: string): void {
    this.clearHistory(path);
    deleteSnapshotFromStore(path);
  }

  async copyTo(sourcePath: string, entryId: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    const content = this.getContentAt(sourcePath, entryId);
    if (content === null) {
      return { success: false, error: "Failed to get content at entry" };
    }

    if (await this.app.vault.adapter.exists(destPath)) {
      return { success: false, error: "File already exists" };
    }

    const parentPath = destPath.substring(0, destPath.lastIndexOf("/"));
    if (parentPath && !(await this.app.vault.adapter.exists(parentPath))) {
      await this.app.vault.createFolder(parentPath);
    }

    await this.app.vault.create(destPath, content);
    return { success: true };
  }

  hasHistory(path: string): boolean {
    const historyData = getHistoryFromStore(path);

    if (!historyData) {
      return false;
    }

    const snapshotExists = this.loadSnapshot(path) !== null;

    if (!snapshotExists) {
      deleteHistoryFromStore(path);
      return false;
    }

    return true;
  }
}

// Singleton
let editHistoryManager: EditHistoryManager | null = null;

export function initEditHistoryManager(
  app: App,
  settings: EditHistorySettings
): EditHistoryManager {
  editHistoryManager = new EditHistoryManager(app, settings);
  return editHistoryManager;
}

export function getEditHistoryManager(): EditHistoryManager | null {
  return editHistoryManager;
}

export function resetEditHistoryManager(): void {
  editHistoryManager = null;
}
