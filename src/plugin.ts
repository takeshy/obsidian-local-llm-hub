import { Plugin, WorkspaceLeaf, MarkdownView, Notice, Modal, TFile, type Editor } from "obsidian";
import { ChatView, VIEW_TYPE_LLM_CHAT } from "src/ui/ChatView";
import { CryptView, CRYPT_VIEW_TYPE } from "src/ui/CryptView";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "src/ui/DashboardView";
import { registerCoreWidgets } from "src/dashboard/widgets/registry";
import { dashboardPath, serializeDashboard, createEmptyDashboard, ensureVaultFolder } from "src/dashboard/dashboardFile";
import { DASHBOARD_FOLDER } from "src/dashboard/types";
import { SettingsTab } from "src/ui/SettingsTab";
import { type LocalLlmHubSettings, type RagSetting, DEFAULT_SETTINGS } from "src/types";
import { WorkspaceStateManager } from "src/core/workspaceStateManager";
import { initLocale, t } from "src/i18n";
import { formatError } from "src/utils/error";
import { EncryptionManager } from "src/plugin/encryptionManager";
import { WorkflowManager } from "src/plugin/workflowManager";
import { SelectionManager } from "src/plugin/selectionManager";
import type { SelectionLocationInfo } from "src/ui/selectionHighlight";
import { McpManager } from "src/core/mcpManager";
import { initEditHistoryManager, getEditHistoryManager } from "src/core/editHistory";
import { cryptoCache } from "src/core/cryptoCache";
import { registerWorkflowCodeBlockProcessor } from "src/ui/workflowCodeBlock";

import { EditHistoryModal } from "src/ui/components/EditHistoryModal";

// Simple event emitter for settings updates
export class SettingsEmitter {
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  on(event: string, listener: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: unknown[]): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        listener(...args);
      }
    }
  }
}

export class LocalLlmHubPlugin extends Plugin {
  settings: LocalLlmHubSettings = { ...DEFAULT_SETTINGS };
  settingsEmitter = new SettingsEmitter();
  wsManager!: WorkspaceStateManager;
  encryptionManager!: EncryptionManager;
  workflowManager!: WorkflowManager;
  mcpManager = new McpManager();
  selectionManager!: SelectionManager;
  /** In-memory only – cleared on Obsidian restart */
  lastActiveChatId: string | null = null;
  private lastActiveMarkdownView: MarkdownView | null = null;

  onload(): void {
    initLocale();

    void this.loadSettings().then(() => {
      this.settingsEmitter.emit("settings-updated", this.settings);

      // Initialize edit history manager
      initEditHistoryManager(this.app, this.settings.editHistory);

      // Apply workspace folder visibility
      this.updateWorkspaceFolderVisibility();

      // Connect enabled MCP servers
      void this.mcpManager.connectAll(this.settings.mcpServers).then(() => {
        this.settingsEmitter.emit("settings-updated", this.settings);
      }).catch((e) => {
        console.error("Local LLM Hub: Failed to connect MCP servers:", formatError(e));
      });
    }).catch((e) => {
      console.error("Local LLM Hub: Failed to load settings:", formatError(e));
    });

    // Initialize encryption manager
    this.encryptionManager = new EncryptionManager(this);

    // Initialize workflow manager
    this.workflowManager = new WorkflowManager(this);

    // Initialize selection manager
    this.selectionManager = new SelectionManager(this);

    // Settings tab
    this.addSettingTab(new SettingsTab(this.app, this));

    // Chat view
    this.registerView(
      VIEW_TYPE_LLM_CHAT,
      (leaf) => new ChatView(leaf, this)
    );

    // CryptView for encrypted files
    this.registerView(
      CRYPT_VIEW_TYPE,
      (leaf) => new CryptView(leaf, this)
    );

    // Register .encrypted extension so Obsidian opens these files in CryptView.
    try {
      this.registerExtensions(["encrypted"], CRYPT_VIEW_TYPE);
    } catch {
      // Extension already registered by another plugin - skip
    }

    // Dashboard view (.dashboard files: widget grid over bases/notes/web)
    registerCoreWidgets();
    this.registerView(
      DASHBOARD_VIEW_TYPE,
      (leaf) => new DashboardView(leaf, this)
    );

    // Register .dashboard extension so Obsidian opens these files in DashboardView
    try {
      this.registerExtensions(["dashboard"], DASHBOARD_VIEW_TYPE);
    } catch {
      // Extension already registered by another plugin — skip
    }

    // Workflow code block: render as Mermaid diagram (Reading mode + Live Preview)
    registerWorkflowCodeBlockProcessor(this, this.app);

    // Ensure views on layout ready and register workflow hotkeys/events
    this.app.workspace.onLayoutReady(() => {
      void this.ensureChatViewExists();
      this.workflowManager.registerHotkeys();
      this.workflowManager.registerEventListeners();
    });

    // Track active markdown view and capture selection when switching to chat
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view?.getViewType() === VIEW_TYPE_LLM_CHAT) {
          this.selectionManager.captureSelectionFromView(this.lastActiveMarkdownView);
        } else {
          this.selectionManager.clearSelectionHighlight();
          if (leaf?.view instanceof MarkdownView) {
            this.lastActiveMarkdownView = leaf.view;
          }
        }
      })
    );

    // Handle file open - check for encrypted files and init snapshots
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file instanceof TFile) {
          void this.encryptionManager.checkAndOpenEncryptedFile(file);
          const manager = getEditHistoryManager();
          if (manager) {
            void manager.initSnapshot(file.path);
          }
        }
      })
    );

    // Handle file rename for edit history
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const manager = getEditHistoryManager();
        if (manager && file instanceof TFile) {
          manager.handleFileRename(oldPath, file.path);
        }
      })
    );

    // Handle file delete for edit history
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        const manager = getEditHistoryManager();
        if (manager && file instanceof TFile) {
          manager.handleFileDelete(file.path);
        }
      })
    );

    // File menu: encrypt/decrypt, snapshot, history
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || !file.path.endsWith(".md")) return;

        menu.addItem((item) => {
          item
            .setTitle(t("command.encryptFile"))
            .setIcon("lock")
            .onClick(() => {
              void this.encryptionManager.encryptFile(file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle(t("editHistory.saveSnapshot"))
            .setIcon("camera")
            .onClick(() => {
              void this.saveSnapshotForFile(file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle(t("editHistory.showHistory"))
            .setIcon("history")
            .onClick(() => {
              new EditHistoryModal(this.app, file.path).open();
            });
        });
      })
    );

    // Ribbon icon
    this.addRibbonIcon("bot", "Open chat", () => {
      void this.activateChatView();
    });

    // Commands
    this.addCommand({
      id: "open-chat",
      name: "Open chat",
      callback: () => {
        void this.activateChatView();
      },
    });

    this.addCommand({
      id: "toggle-chat",
      name: "Toggle chat / editor",
      callback: () => {
        this.toggleChatView();
      },
    });

    // Text processing commands
    this.addCommand({
      id: "summarize",
      name: t("command.summarize"),
      editorCallback: (editor) => {
        this.sendEditorSelectionToChat(editor, "Summarize the following text concisely:\n\n");
      },
    });

    this.addCommand({
      id: "make-professional",
      name: t("command.professional"),
      editorCallback: (editor) => {
        this.sendEditorSelectionToChat(editor, "Rewrite the following text in a professional tone:\n\n");
      },
    });

    this.addCommand({
      id: "action-items",
      name: t("command.actionItems"),
      editorCallback: (editor) => {
        this.sendEditorSelectionToChat(editor, "Extract action items from the following text as a bullet list:\n\n");
      },
    });

    this.addCommand({
      id: "selection-as-prompt",
      name: t("command.selectionPrompt"),
      editorCallback: (editor) => {
        this.sendEditorSelectionToChat(editor, "");
      },
    });

    this.addCommand({
      id: "custom-prompt",
      name: t("command.customPrompt"),
      editorCallback: (editor) => {
        const modal = new CustomPromptModal(this.app, (prompt) => {
          this.sendEditorSelectionToChat(editor, prompt + "\n\n");
        });
        modal.open();
      },
    });

    // Workflow commands
    this.addCommand({
      id: "open-workflow",
      name: t("command.runWorkflow"),
      callback: () => {
        void this.activateChatView("workflow");
      },
    });

    // Dashboard command
    this.addCommand({
      id: "create-dashboard",
      name: t("command.createDashboard"),
      callback: () => {
        void this.createDashboard();
      },
    });

    // Encrypt/Decrypt commands
    this.addCommand({
      id: "encrypt-file",
      name: t("command.encryptFile"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (checking) return true;
        void this.encryptionManager.encryptFile(file);
      },
    });

    this.addCommand({
      id: "decrypt-file",
      name: t("command.decryptFile"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (checking) return true;
        void this.encryptionManager.decryptCurrentFile(file);
      },
    });

    // Edit history commands
    this.addCommand({
      id: "show-edit-history",
      name: t("command.showEditHistory"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (checking) return true;
        new EditHistoryModal(this.app, file.path).open();
      },
    });

    this.addCommand({
      id: "restore-previous-version",
      name: t("command.restorePreviousVersion"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        const manager = getEditHistoryManager();
        if (!manager || !manager.hasHistory(file.path)) return false;
        if (checking) return true;
        new EditHistoryModal(this.app, file.path).open();
      },
    });
  }

  /**
   * Create a new empty `.dashboard` file under `Dashboards/` and open it.
   * Picks a unique "Dashboard", "Dashboard 2", … name.
   */
  async createDashboard(): Promise<void> {
    const { vault, workspace } = this.app;

    let name = "Dashboard";
    let path = dashboardPath(name);
    for (let i = 2; vault.getAbstractFileByPath(path); i++) {
      name = `Dashboard ${i}`;
      path = dashboardPath(name);
    }

    let file: TFile;
    try {
      await ensureVaultFolder(vault, DASHBOARD_FOLDER);
      file = await vault.create(path, serializeDashboard(createEmptyDashboard()));
    } catch (error) {
      new Notice(`Failed to create dashboard: ${String(error)}`);
      return;
    }

    const leaf = workspace.getLeaf(true);
    await leaf.openFile(file);
  }

  private async saveSnapshotForFile(file: TFile): Promise<void> {
    const historyManager = getEditHistoryManager();
    if (!historyManager) {
      new Notice(t("editHistory.notInitialized"));
      return;
    }

    await historyManager.ensureSnapshot(file.path);
    const entry = historyManager.saveEdit({
      path: file.path,
      modifiedContent: await this.app.vault.read(file),
      source: "manual",
    });

    if (entry) {
      new Notice(t("editHistory.saved"));
    } else {
      new Notice(t("editHistory.noChanges"));
    }
  }

  onunload(): void {
    this.workflowManager.cleanup();
    cryptoCache.clear();
    void this.mcpManager.disconnectAll();
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData() as Partial<LocalLlmHubSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // Ensure nested objects have defaults
    if (!this.settings.encryption) {
      this.settings.encryption = { ...DEFAULT_SETTINGS.encryption };
    }
    if (!this.settings.editHistory) {
      this.settings.editHistory = { ...DEFAULT_SETTINGS.editHistory };
    }
    if (!this.settings.editHistory.diff) {
      this.settings.editHistory.diff = { ...DEFAULT_SETTINGS.editHistory.diff };
    }
    if (!this.settings.llmConfig.framework) {
      this.settings.llmConfig.framework = "ollama";
    }
    if (!this.settings.slashCommands) {
      this.settings.slashCommands = [];
    }
    if (!this.settings.enabledWorkflowHotkeys) {
      this.settings.enabledWorkflowHotkeys = [];
    }
    if (!this.settings.enabledWorkflowEventTriggers) {
      this.settings.enabledWorkflowEventTriggers = [];
    }
    // Clean up legacy settings from saved data
    const raw = this.settings as unknown as Record<string, unknown>;
    let needsSave = false;
    if ("skillsFolderPath" in raw) {
      delete raw.skillsFolderPath;
      needsSave = true;
    }
    if ("workspaceFolder" in raw) {
      delete raw.workspaceFolder;
      needsSave = true;
    }
    if (needsSave) {
      await this.saveSettings();
    }
    if (this.settings.hideWorkspaceFolder === undefined) {
      this.settings.hideWorkspaceFolder = true;
    }
    if (!this.settings.mcpServers) {
      this.settings.mcpServers = [];
    }

    // Initialize workspace state manager
    this.wsManager = new WorkspaceStateManager(this.app, this.settingsEmitter);
    await this.wsManager.loadOrCreateWorkspaceState();

    // Migrate old ragConfig to named RAG setting
    if (this.settings.ragConfig) {
      const migrated = await this.wsManager.migrateFromRagConfig(this.settings.ragConfig);
      if (migrated) {
        delete this.settings.ragConfig;
        await this.saveSettings();
      }
    }
  }

  // --- RAG setting delegates ---

  getRagSettingNames(): string[] {
    return this.wsManager.getRagSettingNames();
  }

  getRagSetting(name: string): RagSetting | null {
    return this.wsManager.getRagSetting(name);
  }

  getRagSearchSetting(name: string): RagSetting | null {
    const setting = this.getRagSetting(name);
    if (!setting) return null;
    const sourceName = setting.sourceRagSettings[0];
    const sourceSetting = sourceName ? this.getRagSetting(sourceName) : null;
    if (!sourceSetting) return setting;
    return {
      ...setting,
      embeddingModel: sourceSetting.embeddingModel,
      embeddingBaseUrl: sourceSetting.embeddingBaseUrl,
    };
  }

  getSelectedRagSettingName(): string | null {
    return this.wsManager.workspaceState.selectedRagSetting;
  }

  getSelectedRagSetting(): RagSetting | null {
    return this.wsManager.getSelectedRagSetting();
  }

  async selectRagSetting(name: string | null): Promise<void> {
    await this.wsManager.selectRagSetting(name);
  }

  async createRagSetting(name: string, setting?: Partial<RagSetting>): Promise<void> {
    await this.wsManager.createRagSetting(name, setting);
  }

  async updateRagSetting(name: string, updates: Partial<RagSetting>): Promise<void> {
    await this.wsManager.updateRagSetting(name, updates);
  }

  async deleteRagSetting(name: string): Promise<void> {
    await this.wsManager.deleteRagSetting(name);
  }

  async renameRagSetting(oldName: string, newName: string): Promise<void> {
    await this.wsManager.renameRagSetting(oldName, newName);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.settingsEmitter.emit("settings-updated", this.settings);

    // Update edit history manager settings
    const manager = getEditHistoryManager();
    if (manager) {
      manager.updateSettings(this.settings.editHistory);
    }

    // Update workspace folder visibility
    this.updateWorkspaceFolderVisibility();
  }

  private updateWorkspaceFolderVisibility(): void {
    activeDocument.body.toggleClass("llm-hub-hide-workspace-folder", this.settings.hideWorkspaceFolder);
  }

  private async ensureChatViewExists(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_LLM_CHAT);
    if (existing.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_LLM_CHAT, active: false });
      }
    }
  }

  async activateChatView(tab?: "chat" | "workflow"): Promise<void> {
    // Capture selection before switching focus
    this.selectionManager.captureSelection();

    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_LLM_CHAT);
    let leaf: WorkspaceLeaf;

    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      const rightLeaf = this.app.workspace.getRightLeaf(false);
      if (!rightLeaf) return;
      leaf = rightLeaf;
      await leaf.setViewState({ type: VIEW_TYPE_LLM_CHAT, active: true });
    }

    void this.app.workspace.revealLeaf(leaf);

    if (tab && leaf.view instanceof ChatView) {
      leaf.view.setActiveTab(tab);
    }
  }

  private toggleChatView(): void {
    const chatLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_LLM_CHAT);
    const activeLeaf = this.app.workspace.getActiveViewOfType(ChatView);

    if (activeLeaf) {
      // Currently in chat, go back to last editor
      this.selectionManager.clearSelectionHighlight();
      if (this.lastActiveMarkdownView) {
        const editorLeaf = this.lastActiveMarkdownView.leaf;
        void this.app.workspace.revealLeaf(editorLeaf);
      }
    } else {
      // Not in chat, capture selection and open/activate chat
      this.selectionManager.captureSelectionFromView(this.lastActiveMarkdownView);
      if (chatLeaves.length > 0) {
        void this.app.workspace.revealLeaf(chatLeaves[0]);
      } else {
        void this.activateChatView();
      }
    }
  }

  getSelection(): string | null {
    // First try live selection from active editor
    const view = this.lastActiveMarkdownView || this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) {
      const sel = view.editor.getSelection();
      if (sel) return sel;
    }
    // Fallback to cached selection (captured before focus switched to chat)
    return this.selectionManager.getLastSelection() || null;
  }

  getSelectionLocation(): SelectionLocationInfo | null {
    return this.selectionManager.getSelectionLocation();
  }

  getActiveNoteContent(): string | null {
    const view = this.lastActiveMarkdownView || this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    return view.editor.getValue() || null;
  }

  private sendEditorSelectionToChat(editor: Editor, prefix: string): void {
    const selection = editor.getSelection();
    if (!selection) {
      new Notice("No text selected");
      return;
    }

    const message = prefix + selection;
    void this.activateChatView().then(() => {
      this.settingsEmitter.emit("send-to-chat", message);
    });
  }
}

class CustomPromptModal extends Modal {
  private onSubmit: (prompt: string) => void;

  constructor(app: import("obsidian").App, onSubmit: (prompt: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("command.customPrompt") });

    const input = contentEl.createEl("textarea", {
      attr: {
        placeholder: t("command.customPromptPlaceholder"),
        rows: "4",
      },
    });
    input.setCssStyles({ width: "100%" });

    const buttonContainer = contentEl.createDiv({ cls: "llm-hub-modal-buttons" });
    const submitBtn = buttonContainer.createEl("button", { text: t("common.save"), cls: "mod-cta" });
    submitBtn.addEventListener("click", () => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        this.close();
      }
    });
    const cancelBtn = buttonContainer.createEl("button", { text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    input.focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}
