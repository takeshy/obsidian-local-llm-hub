import { Plugin, WorkspaceLeaf, MarkdownView, Notice, Modal, TFile, type Editor } from "obsidian";
import { ChatView, VIEW_TYPE_LLM_CHAT } from "src/ui/ChatView";
import { WorkflowView, VIEW_TYPE_WORKFLOW } from "src/ui/WorkflowView";
import { CryptView, CRYPT_VIEW_TYPE } from "src/ui/CryptView";
import { SettingsTab } from "src/ui/SettingsTab";
import { type LocalLlmHubSettings, DEFAULT_SETTINGS } from "src/types";
import { initLocale, t } from "src/i18n";
import { formatError } from "src/utils/error";
import { EncryptionManager } from "src/plugin/encryptionManager";
import { WorkflowManager } from "src/plugin/workflowManager";
import { initEditHistoryManager, getEditHistoryManager } from "src/core/editHistory";

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
  encryptionManager!: EncryptionManager;
  workflowManager!: WorkflowManager;
  private lastActiveMarkdownView: MarkdownView | null = null;

  onload(): void {
    initLocale();

    void this.loadSettings().then(() => {
      this.settingsEmitter.emit("settings-updated", this.settings);

      // Initialize edit history manager
      initEditHistoryManager(this.app, this.settings.editHistory);
    }).catch((e) => {
      console.error("Local LLM Hub: Failed to load settings:", formatError(e));
    });

    // Initialize encryption manager
    this.encryptionManager = new EncryptionManager(this);

    // Initialize workflow manager
    this.workflowManager = new WorkflowManager(this);

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

    // Workflow view
    this.registerView(
      VIEW_TYPE_WORKFLOW,
      (leaf) => new WorkflowView(leaf, this)
    );

    // Ensure views on layout ready and register workflow hotkeys/events
    this.app.workspace.onLayoutReady(() => {
      void this.ensureChatViewExists();
      void this.ensureWorkflowViewExists();
      this.workflowManager.registerHotkeys();
      this.workflowManager.registerEventListeners();
    });

    // Track active markdown view for selection capture
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView) {
          this.lastActiveMarkdownView = leaf.view;
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

    // File menu: encrypt/decrypt
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
      })
    );

    // Ribbon icon
    this.addRibbonIcon("message-square", "Open chat", () => {
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
        void this.activateWorkflowView();
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

  onunload(): void {
    this.workflowManager.cleanup();
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
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
    if (!this.settings.slashCommands) {
      this.settings.slashCommands = [];
    }
    if (!this.settings.enabledWorkflowHotkeys) {
      this.settings.enabledWorkflowHotkeys = [];
    }
    if (!this.settings.enabledWorkflowEventTriggers) {
      this.settings.enabledWorkflowEventTriggers = [];
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.settingsEmitter.emit("settings-updated", this.settings);

    // Update edit history manager settings
    const manager = getEditHistoryManager();
    if (manager) {
      manager.updateSettings(this.settings.editHistory);
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

  private async ensureWorkflowViewExists(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_WORKFLOW);
    if (existing.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_WORKFLOW, active: false });
      }
    }
  }

  async activateWorkflowView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_WORKFLOW);
    let leaf: WorkspaceLeaf;

    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      const rightLeaf = this.app.workspace.getRightLeaf(false);
      if (!rightLeaf) return;
      leaf = rightLeaf;
      await leaf.setViewState({ type: VIEW_TYPE_WORKFLOW, active: true });
    }

    void this.app.workspace.revealLeaf(leaf);
  }

  async activateChatView(): Promise<void> {
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
  }

  private toggleChatView(): void {
    const chatLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_LLM_CHAT);
    const activeLeaf = this.app.workspace.getActiveViewOfType(ChatView);

    if (activeLeaf) {
      // Currently in chat, go back to last editor
      if (this.lastActiveMarkdownView) {
        const editorLeaf = this.lastActiveMarkdownView.leaf;
        void this.app.workspace.revealLeaf(editorLeaf);
      }
    } else if (chatLeaves.length > 0) {
      void this.app.workspace.revealLeaf(chatLeaves[0]);
    } else {
      void this.activateChatView();
    }
  }

  getSelection(): string | null {
    const view = this.lastActiveMarkdownView || this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    const editor = view.editor;
    return editor.getSelection() || null;
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
