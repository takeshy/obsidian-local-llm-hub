import type { App } from "obsidian";
import type { SettingsEmitter } from "../plugin";
import {
  type WorkspaceState,
  type RagSetting,
  type RagConfig,
  DEFAULT_WORKSPACE_STATE,
  DEFAULT_RAG_SETTING,
  WORKSPACE_FOLDER,
} from "../types";
import { migrateOldRagIndex, renameRagIndex, sanitizeSettingName } from "./ragStorage";
import { getRagStore } from "./ragStore";

const WORKSPACE_STATE_FILENAME = "workspace-state.json";

export class WorkspaceStateManager {
  workspaceState: WorkspaceState = { ...DEFAULT_WORKSPACE_STATE, ragSettings: {} };

  constructor(
    private app: App,
    private settingsEmitter: SettingsEmitter,
    private getWorkspaceFolder: () => string = () => WORKSPACE_FOLDER,
  ) {}

  private workspaceFolder(): string {
    return this.getWorkspaceFolder() || WORKSPACE_FOLDER;
  }

  private getFilePath(): string {
    return `${this.workspaceFolder()}/${WORKSPACE_STATE_FILENAME}`;
  }

  private async ensureWorkspaceFolder(): Promise<void> {
    let currentPath = "";
    for (const segment of this.workspaceFolder().split("/").filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!(await this.app.vault.adapter.exists(currentPath))) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  async loadWorkspaceState(): Promise<void> {
    this.workspaceState = { ...DEFAULT_WORKSPACE_STATE, ragSettings: {} };
    const filePath = this.getFilePath();

    try {
      if (await this.app.vault.adapter.exists(filePath)) {
        const content = await this.app.vault.adapter.read(filePath);
        const loaded = JSON.parse(content) as Partial<WorkspaceState>;
        this.workspaceState = { ...DEFAULT_WORKSPACE_STATE, ...loaded };

        // Ensure each RAG setting has all required fields (migration for new fields)
        for (const [name, setting] of Object.entries(this.workspaceState.ragSettings)) {
          this.workspaceState.ragSettings[name] = { ...DEFAULT_RAG_SETTING, ...setting };
        }
      }
    } catch (error) {
      console.error("Local LLM Hub: Failed to load workspace state:", error);
    }
  }

  async loadOrCreateWorkspaceState(): Promise<void> {
    await this.loadWorkspaceState();
    const filePath = this.getFilePath();
    if (!(await this.app.vault.adapter.exists(filePath))) {
      await this.saveWorkspaceState();
    }
  }

  async saveWorkspaceState(): Promise<void> {
    const filePath = this.getFilePath();
    const content = JSON.stringify(this.workspaceState, null, 2);

    await this.ensureWorkspaceFolder();

    await this.app.vault.adapter.write(filePath, content);
  }

  /**
   * Migrate old single ragConfig to named RAG setting.
   * Returns true if migration was performed.
   */
  async migrateFromRagConfig(ragConfig: RagConfig): Promise<boolean> {
    // Only migrate if workspace state has no settings yet
    if (Object.keys(this.workspaceState.ragSettings).length > 0) {
      return false;
    }

    const settingName = "Default";
    const setting: RagSetting = {
      ...DEFAULT_RAG_SETTING,
      embeddingModel: ragConfig.embeddingModel || DEFAULT_RAG_SETTING.embeddingModel,
      embeddingBaseUrl: ragConfig.embeddingBaseUrl || "",
      chunkSize: ragConfig.chunkSize ?? DEFAULT_RAG_SETTING.chunkSize,
      chunkOverlap: ragConfig.chunkOverlap ?? DEFAULT_RAG_SETTING.chunkOverlap,
      topK: ragConfig.topK ?? DEFAULT_RAG_SETTING.topK,
      minScore: ragConfig.minScore ?? DEFAULT_RAG_SETTING.minScore,
      targetFolders: ragConfig.targetFolders || [],
      excludePatterns: ragConfig.excludePatterns || [],
      externalIndexPath: ragConfig.externalIndexPath || "",
    };

    this.workspaceState.ragSettings[settingName] = setting;
    this.workspaceState.selectedRagSetting = ragConfig.enabled ? settingName : null;

    // Migrate old flat index files to named subdirectory
    await migrateOldRagIndex(this.app, settingName, this.workspaceFolder());

    await this.saveWorkspaceState();
    return true;
  }

  // --- RAG setting CRUD ---

  getSelectedRagSetting(): RagSetting | null {
    const name = this.workspaceState.selectedRagSetting;
    if (!name) return null;
    return this.workspaceState.ragSettings[name] || null;
  }

  getRagSetting(name: string): RagSetting | null {
    return this.workspaceState.ragSettings[name] || null;
  }

  getRagSettingNames(): string[] {
    return Object.keys(this.workspaceState.ragSettings);
  }

  async selectRagSetting(name: string | null): Promise<void> {
    this.workspaceState.selectedRagSetting = name;
    await this.saveWorkspaceState();
    this.settingsEmitter.emit("rag-setting-changed", name);
  }

  private checkSanitizedCollision(newName: string, excludeName?: string): void {
    const newSanitized = sanitizeSettingName(newName);
    for (const existing of Object.keys(this.workspaceState.ragSettings)) {
      if (existing === excludeName) continue;
      if (sanitizeSettingName(existing) === newSanitized) {
        throw new Error(`RAG setting "${newName}" conflicts with existing setting "${existing}" (same directory name)`);
      }
    }
  }

  async createRagSetting(name: string, setting?: Partial<RagSetting>): Promise<void> {
    if (this.workspaceState.ragSettings[name]) {
      throw new Error(`RAG setting "${name}" already exists`);
    }
    this.checkSanitizedCollision(name);
    this.workspaceState.ragSettings[name] = { ...DEFAULT_RAG_SETTING, ...setting };
    await this.saveWorkspaceState();
    this.settingsEmitter.emit("workspace-state-loaded", this.workspaceState);
  }

  async updateRagSetting(name: string, updates: Partial<RagSetting>): Promise<void> {
    const existing = this.workspaceState.ragSettings[name];
    if (!existing) {
      throw new Error(`RAG setting "${name}" not found`);
    }
    const next = { ...existing, ...updates };
    if (next.sourceRagSettings.length > 0) {
      next.sourceRagSettings = next.sourceRagSettings.filter(sourceName =>
        sourceName !== name && !!this.workspaceState.ragSettings[sourceName]
      );
    }
    this.workspaceState.ragSettings[name] = next;
    await this.saveWorkspaceState();
  }

  async deleteRagSetting(name: string): Promise<void> {
    if (!this.workspaceState.ragSettings[name]) return;
    delete this.workspaceState.ragSettings[name];
    for (const setting of Object.values(this.workspaceState.ragSettings)) {
      setting.sourceRagSettings = setting.sourceRagSettings.filter(sourceName => sourceName !== name);
    }
    if (this.workspaceState.selectedRagSetting === name) {
      this.workspaceState.selectedRagSetting = null;
    }
    await this.saveWorkspaceState();
    this.settingsEmitter.emit("workspace-state-loaded", this.workspaceState);
  }

  async renameRagSetting(oldName: string, newName: string): Promise<void> {
    if (!this.workspaceState.ragSettings[oldName]) {
      throw new Error(`RAG setting "${oldName}" not found`);
    }
    if (this.workspaceState.ragSettings[newName]) {
      throw new Error(`RAG setting "${newName}" already exists`);
    }
    this.checkSanitizedCollision(newName, oldName);

    // Move on-disk index directory
    await renameRagIndex(this.app, oldName, newName, this.workspaceFolder());

    // Invalidate RagStore cache for old name
    const store = getRagStore();
    store.invalidateEntry(oldName);

    this.workspaceState.ragSettings[newName] = this.workspaceState.ragSettings[oldName];
    delete this.workspaceState.ragSettings[oldName];
    for (const setting of Object.values(this.workspaceState.ragSettings)) {
      setting.sourceRagSettings = setting.sourceRagSettings.map(sourceName =>
        sourceName === oldName ? newName : sourceName
      );
    }
    if (this.workspaceState.selectedRagSetting === oldName) {
      this.workspaceState.selectedRagSetting = newName;
    }
    await this.saveWorkspaceState();
    this.settingsEmitter.emit("workspace-state-loaded", this.workspaceState);
  }
}
