import { setMcpApprovalHandler, sameMcpConnection } from "./core/mcpApproval";
import { McpApprovalModal } from "./ui/components/McpApprovalModal";
import { Plugin, WorkspaceLeaf, MarkdownView, Notice, Modal, TFile, type Editor, type EventRef } from "obsidian";
import { ChatView, VIEW_TYPE_LLM_CHAT } from "src/ui/ChatView";
import { CryptView, CRYPT_VIEW_TYPE } from "src/ui/CryptView";
import { SettingsTab } from "src/ui/SettingsTab";
import { type LocalLlmHubSettings, type LocalLlmProfile, type RagSetting, DEFAULT_SETTINGS } from "src/types";
import { WorkspaceStateManager } from "src/core/workspaceStateManager";
import { getRagStore } from "src/core/ragStore";
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
import { generateDashboardBase, generateDashboardWorkflow, listDashboardModels, rewriteDashboardText, runDashboardWorkflow } from "src/integrations/dashboardHubCapabilities";
import { REGISTER_RUNTIME_SKILL_EVENT, REQUEST_RUNTIME_SKILLS_EVENT, UNREGISTER_RUNTIME_SKILL_EVENT, registerRuntimeSkill, unregisterRuntimeSkill } from "src/core/runtimeSkills";
import { registerDiscussionHubIntegration } from "src/integrations/discussionHubCapabilities";

import { EditHistoryModal } from "src/ui/components/EditHistoryModal";

interface DashboardHubIntegration {
  protocolVersion: 1;
  id: string;
  name: string;
  listModels: () => Promise<Array<{ id: string; name: string; capabilities: { text: boolean; vaultRead: boolean; tools: boolean } }>>;
  getDefaultModel: () => Promise<string | null>;
  openChatWithDraft: (draft: string) => void | Promise<void>;
  askChatAboutSelection: (request: { text: string; sourcePath?: string }) => void | Promise<void>;
  runWorkflow?: (request: { workflowPath: string; outputVariable?: string; abortSignal?: AbortSignal }) => Promise<string>;
  generateBase?: (request: Parameters<typeof generateDashboardBase>[1]) => Promise<string>;
  rewriteText?: (request: Parameters<typeof rewriteDashboardText>[1]) => Promise<string>;
  generateWorkflow?: (request: Parameters<typeof generateDashboardWorkflow>[1]) => Promise<string>;
}

interface DashboardHubApi {
  registerIntegration: (integration: DashboardHubIntegration) => () => void;
  createDashboard: (requestedName?: string) => Promise<TFile | null>;
}

interface DashboardWorkspaceEvents {
  on: (name: "dashboard-hub:ready", callback: (hub: DashboardHubApi) => void) => EventRef;
  trigger: {
    (name: "dashboard-hub:register-integration", integration: DashboardHubIntegration): void;
    (name: "dashboard-hub:unregister-integration", request: { id: string; integration: DashboardHubIntegration }): void;
  };
}

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

    let approvalModal: McpApprovalModal | undefined;
    setMcpApprovalHandler({
      getServer: server => this.settings.mcpServers.find(saved => sameMcpConnection(saved, server)),
      request: async (server, tool, args, canRemember) => {
        approvalModal = new McpApprovalModal(this.app, server, tool, args, canRemember);
        try {
          return await approvalModal.openAndWait();
        } finally {
          approvalModal = undefined;
        }
      },
      remember: async (server, tool) => {
        const previous = server.allowedTools;
        server.allowedTools = [...new Set([...(previous ?? []), tool])];
        try {
          await this.saveSettings();
        } catch (error) {
          server.allowedTools = previous;
          throw error;
        }
      },
    });
    this.register(() => {
      setMcpApprovalHandler(undefined);
      approvalModal?.close();
    });


    // Views restored by Obsidian can render before the asynchronous settings
    // load completes. Keep a usable default workspace state available from the
    // start; loadSettings() hydrates this same manager below.
    this.wsManager = new WorkspaceStateManager(this.app, this.settingsEmitter, () => this.settings.workspaceFolder);

    void this.loadSettings().then(() => {
      this.settingsEmitter.emit("settings-updated", this.settings);

      // Initialize edit history manager
      initEditHistoryManager(this.app, this.settings.editHistory);
      getRagStore().workspaceFolder = this.settings.workspaceFolder;

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
    this.registerRuntimeSkillContributions();
    this.registerDashboardHubIntegration();
    registerDiscussionHubIntegration(this);
    this.notifyDashboardHubMigration();
    // Compatibility command for existing hotkeys; Dashboard Hub performs the
    // actual creation and remains the sole owner of .dashboard files.
    this.addCommand({
      id: "create-dashboard",
      name: t("command.createDashboard"),
      callback: () => { void this.createDashboard(); },
    });

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

    // Workflow code block: render as Mermaid diagram (Reading mode + Live Preview)
    registerWorkflowCodeBlockProcessor(this, this.app);

    // Ensure views on layout ready and register workflow hotkeys/events
    this.app.workspace.onLayoutReady(() => {
      void this.ensureChatViewExists();
      this.workflowManager.registerHotkeys();
      this.workflowManager.registerEventListeners();
      void this.workflowManager.triggerStartupWorkflows();
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

  /** Delegate dashboard creation to the standalone Dashboard Hub plugin. */
  async createDashboard(requestedName = "Dashboard"): Promise<TFile | null> {
    const app = this.app as typeof this.app & { plugins?: { plugins?: Record<string, unknown> } };
    const dashboardHub = app.plugins?.plugins?.["dashboard-hub"] as DashboardHubApi | undefined;
    if (!dashboardHub?.createDashboard) {
      new Notice("Install and enable Dashboard Hub to create dashboards.");
      return null;
    }
    return dashboardHub.createDashboard(requestedName);
  }

  private notifyDashboardHubMigration(): void {
    this.app.workspace.onLayoutReady(() => {
      const app = this.app as typeof this.app & {
        plugins?: {
          plugins?: Record<string, unknown>;
          enabledPlugins?: { has: (id: string) => boolean };
        };
      };
      if (app.plugins?.plugins?.["dashboard-hub"] || app.plugins?.enabledPlugins?.has("dashboard-hub")) return;
      if (!app.vault.getFiles().some((file) => file.extension === "dashboard")) return;

      const storageKey = `dashboard-hub:migration-notice:${app.vault.getName()}`;
      try {
        if (window.localStorage.getItem(storageKey)) return;
        window.localStorage.setItem(storageKey, "shown");
      } catch {
        const shared = window as typeof window & { __dashboardHubMigrationNoticeShown?: boolean };
        if (shared.__dashboardHubMigrationNoticeShown) return;
        shared.__dashboardHubMigrationNoticeShown = true;
      }
      new Notice("Existing .dashboard files now require the separate Dashboard Hub plugin. Install and enable Dashboard Hub to open them.", 15000);
    });
  }

  async openChatWithDraft(content: string): Promise<void> {
    await this.activateChatView();
    this.settingsEmitter.emit("send-to-chat", content);
  }

  async askChatAboutSelection(selection: { text: string; sourcePath?: string }): Promise<void> {
    const text = selection.text.trim();
    if (!text) return;
    const source = selection.sourcePath ? `From ${selection.sourcePath}:\n` : "";
    await this.openChatWithDraft(`${source}${text}`);
  }

  private registerDashboardHubIntegration(): void {
    const integration: DashboardHubIntegration = {
      protocolVersion: 1,
      id: this.manifest.id,
      name: this.manifest.name,
      listModels: () => Promise.resolve(listDashboardModels(this)),
      getDefaultModel: () => Promise.resolve(this.settings.llmConfig.model || null),
      openChatWithDraft: (draft) => this.openChatWithDraft(draft),
      askChatAboutSelection: (request) => this.askChatAboutSelection(request),
      runWorkflow: (request) => runDashboardWorkflow(this, request),
      generateBase: (request) => generateDashboardBase(this, request),
      rewriteText: (request) => rewriteDashboardText(this, request),
      generateWorkflow: (request) => generateDashboardWorkflow(this, request),
    };
    const workspace = this.app.workspace as unknown as DashboardWorkspaceEvents;
    this.registerEvent(workspace.on("dashboard-hub:ready", (hub) => {
      hub.registerIntegration(integration);
    }));
    workspace.trigger("dashboard-hub:register-integration", integration);
    this.register(() => {
      workspace.trigger("dashboard-hub:unregister-integration", { id: integration.id, integration });
    });
  }

  private registerRuntimeSkillContributions(): void {
    const workspace = this.app.workspace as unknown as {
      on: (name: string, callback: (value: unknown) => void) => EventRef;
      trigger: (name: string) => void;
    };
    this.registerEvent(workspace.on(REGISTER_RUNTIME_SKILL_EVENT, (value) => {
      if (registerRuntimeSkill(value)) this.settingsEmitter.emit("skills-changed");
    }));
    this.registerEvent(workspace.on(UNREGISTER_RUNTIME_SKILL_EVENT, (value) => {
      if (unregisterRuntimeSkill(value)) this.settingsEmitter.emit("skills-changed");
    }));
    workspace.trigger(REQUEST_RUNTIME_SKILLS_EVENT);
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
    let needsSave = false;
    if (data && Object.keys(data).length > 0 && data.maxSavedChatHistories === undefined) {
      this.settings.maxSavedChatHistories = 0;
    }
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
    if (!this.settings.llmProfiles || Object.keys(this.settings.llmProfiles).length === 0) {
      const profileName = "Default";
      this.settings.llmProfiles = {
        [profileName]: {
          config: { ...this.settings.llmConfig },
          availableModels: [...(this.settings.availableModels || [])],
          verified: this.settings.llmVerified,
        },
      };
      this.settings.selectedLlmProfile = profileName;
      needsSave = true;
    } else if (!this.settings.llmProfiles[this.settings.selectedLlmProfile]) {
      this.settings.selectedLlmProfile = Object.keys(this.settings.llmProfiles)[0];
      this.applySelectedLlmProfile();
      needsSave = true;
    } else {
      this.applySelectedLlmProfile();
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
    if (!Array.isArray(this.settings.vaultToolAllowedFolders)) {
      this.settings.vaultToolAllowedFolders = [];
    }
    if (!this.settings.knowledgeSources) {
      this.settings.knowledgeSources = [];
    }
    // Migrate legacy settings from saved data
    const raw = this.settings as unknown as Record<string, unknown>;
    if ("skillsFolderPath" in raw) {
      if (typeof raw.skillsFolderPath === "string" && !(data && "skillsFolder" in data)) {
        this.settings.skillsFolder = raw.skillsFolderPath;
      }
      delete raw.skillsFolderPath;
      needsSave = true;
    }
    this.settings.workspaceFolder = this.settings.workspaceFolder || DEFAULT_SETTINGS.workspaceFolder;
    this.settings.skillsFolder = this.settings.skillsFolder || DEFAULT_SETTINGS.skillsFolder;
    if (needsSave) {
      await this.saveSettings();
    }
    if (this.settings.hideWorkspaceFolder === undefined) {
      this.settings.hideWorkspaceFolder = true;
    }
    if (!this.settings.mcpServers) {
      this.settings.mcpServers = [];
    }
    if (!Array.isArray(this.settings.agentPlugins)) {
      this.settings.agentPlugins = [];
    }
    // Hydrate the workspace state manager created synchronously in onload so
    // restored views can safely use the default state during startup.
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
    this.syncSelectedLlmProfile();
    await this.saveData(this.settings);
    getRagStore().workspaceFolder = this.settings.workspaceFolder;
    this.settingsEmitter.emit("settings-updated", this.settings);

    // Update edit history manager settings
    const manager = getEditHistoryManager();
    if (manager) {
      manager.updateSettings(this.settings.editHistory);
    }

    // Update workspace folder visibility
    this.updateWorkspaceFolderVisibility();
  }

  applySelectedLlmProfile(): void {
    const profile = this.settings.llmProfiles[this.settings.selectedLlmProfile];
    if (!profile) return;
    this.settings.llmConfig = { ...profile.config };
    this.settings.availableModels = [...profile.availableModels];
    this.settings.llmVerified = profile.verified;
  }

  syncSelectedLlmProfile(): void {
    const name = this.settings.selectedLlmProfile;
    if (!name || !this.settings.llmProfiles[name]) return;
    this.settings.llmProfiles[name] = {
      config: { ...this.settings.llmConfig },
      availableModels: [...this.settings.availableModels],
      verified: this.settings.llmVerified,
    };
  }

  async selectLlmProfile(name: string): Promise<void> {
    if (!this.settings.llmProfiles[name]) throw new Error(`LLM profile not found: ${name}`);
    this.syncSelectedLlmProfile();
    this.settings.selectedLlmProfile = name;
    this.applySelectedLlmProfile();
    await this.saveSettings();
  }

  async createLlmProfile(name: string): Promise<void> {
    if (this.settings.llmProfiles[name]) throw new Error(`LLM profile already exists: ${name}`);
    const profile: LocalLlmProfile = {
      config: { ...DEFAULT_SETTINGS.llmConfig },
      availableModels: [],
      verified: false,
    };
    this.syncSelectedLlmProfile();
    this.settings.llmProfiles[name] = profile;
    this.settings.selectedLlmProfile = name;
    this.applySelectedLlmProfile();
    await this.saveSettings();
  }

  async renameLlmProfile(oldName: string, newName: string): Promise<void> {
    if (!this.settings.llmProfiles[oldName]) throw new Error(`LLM profile not found: ${oldName}`);
    if (oldName !== newName && this.settings.llmProfiles[newName]) throw new Error(`LLM profile already exists: ${newName}`);
    if (oldName === newName) return;
    this.settings.llmProfiles[newName] = this.settings.llmProfiles[oldName];
    delete this.settings.llmProfiles[oldName];
    if (this.settings.selectedLlmProfile === oldName) this.settings.selectedLlmProfile = newName;
    await this.saveSettings();
  }

  async deleteLlmProfile(name: string): Promise<void> {
    const names = Object.keys(this.settings.llmProfiles);
    if (!this.settings.llmProfiles[name]) throw new Error(`LLM profile not found: ${name}`);
    if (names.length <= 1) throw new Error("At least one LLM profile is required");
    delete this.settings.llmProfiles[name];
    if (this.settings.selectedLlmProfile === name) {
      this.settings.selectedLlmProfile = Object.keys(this.settings.llmProfiles)[0];
      this.applySelectedLlmProfile();
    }
    await this.saveSettings();
  }

  private updateWorkspaceFolderVisibility(): void {
    activeDocument.body.toggleClass("llm-hub-hide-workspace-folder", this.settings.hideWorkspaceFolder);
    activeDocument.querySelectorAll(".llm-hub-workspace-folder-hidden").forEach(el =>
      el.classList.remove("llm-hub-workspace-folder-hidden"));
    if (this.settings.hideWorkspaceFolder) {
      activeDocument.querySelectorAll(".nav-folder-title").forEach(el => {
        if (el.getAttribute("data-path") === this.settings.workspaceFolder) {
          el.parentElement?.classList.add("llm-hub-workspace-folder-hidden");
        }
      });
    }
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
    if (view?.editor) {
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
    if (!view?.editor) return null;
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
