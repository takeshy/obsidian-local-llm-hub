import { Plugin, WorkspaceLeaf, MarkdownView, Notice, Modal, type Editor } from "obsidian";
import { ChatView, VIEW_TYPE_LLM_CHAT } from "src/ui/ChatView";
import { SettingsTab } from "src/ui/SettingsTab";
import { type LocalLlmHubSettings, DEFAULT_SETTINGS } from "src/types";
import { initLocale, t } from "src/i18n";
import { formatError } from "src/utils/error";

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
  private lastActiveMarkdownView: MarkdownView | null = null;

  onload(): void {
    initLocale();

    void this.loadSettings().then(() => {
      this.settingsEmitter.emit("settings-updated", this.settings);
    }).catch((e) => {
      console.error("Local LLM Hub: Failed to load settings:", formatError(e));
    });

    // Settings tab
    this.addSettingTab(new SettingsTab(this.app, this));

    // Chat view
    this.registerView(
      VIEW_TYPE_LLM_CHAT,
      (leaf) => new ChatView(leaf, this)
    );

    // Ensure chat view on layout ready
    this.app.workspace.onLayoutReady(() => {
      void this.ensureChatViewExists();
    });

    // Track active markdown view for selection capture
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView) {
          this.lastActiveMarkdownView = leaf.view;
        }
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
  }

  onunload(): void {
    // Cleanup handled by Obsidian
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.settingsEmitter.emit("settings-updated", this.settings);
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
