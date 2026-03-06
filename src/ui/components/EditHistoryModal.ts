import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { t } from "src/i18n";
import { formatError } from "src/utils/error";
import { getEditHistoryManager, type EditHistoryEntry } from "src/core/editHistory";
import { reconstructContent } from "src/core/diffUtils";

type DisplayEntry = EditHistoryEntry & { origin: "local" };

function generateCopyFilename(originalPath: string): string {
  const now = new Date();
  const datetime = now.toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "_")
    .slice(0, 15);

  const ext = originalPath.lastIndexOf(".");
  if (ext === -1) {
    return `${originalPath}_${datetime}`;
  }
  return `${originalPath.slice(0, ext)}_${datetime}${originalPath.slice(ext)}`;
}

class CopyInputModal extends Modal {
  private defaultPath: string;
  private onSubmit: (destPath: string) => void | Promise<void>;
  private inputEl: HTMLInputElement | null = null;

  constructor(app: App, defaultPath: string, onSubmit: (destPath: string) => void | Promise<void>) {
    super(app);
    this.defaultPath = defaultPath;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("editHistoryModal.copyTo") });

    const inputContainer = contentEl.createDiv({ cls: "llm-hub-copy-input-container" });
    this.inputEl = inputContainer.createEl("input", {
      type: "text",
      value: this.defaultPath,
      cls: "llm-hub-copy-input",
    });

    this.inputEl.addEventListener("focus", () => {
      this.inputEl?.select();
    });

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && this.inputEl?.value) {
        this.close();
        void this.onSubmit(this.inputEl.value);
      }
    });

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    buttonContainer.createEl("button", {
      text: t("common.cancel"),
    }).addEventListener("click", () => {
      this.close();
    });

    const submitBtn = buttonContainer.createEl("button", {
      text: t("editHistoryModal.copy"),
      cls: "mod-cta",
    });
    submitBtn.addEventListener("click", () => {
      if (this.inputEl?.value) {
        this.close();
        void this.onSubmit(this.inputEl.value);
      }
    });

    setTimeout(() => {
      this.inputEl?.focus();
    }, 50);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class LocalConfirmModal extends Modal {
  private message: string;
  private onConfirm: () => void | Promise<void>;

  constructor(app: App, message: string, onConfirm: () => void | Promise<void>) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    buttonContainer.createEl("button", {
      text: t("common.cancel"),
    }).addEventListener("click", () => {
      this.close();
    });

    const confirmBtn = buttonContainer.createEl("button", {
      text: t("common.confirm"),
      cls: "mod-warning",
    });
    confirmBtn.addEventListener("click", () => {
      this.close();
      void this.onConfirm();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function setupDragHandle(dragHandle: HTMLElement, modalEl: HTMLElement): void {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const onMouseDown = (e: MouseEvent) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = modalEl.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;

    modalEl.setCssStyles({
      position: "fixed",
      left: `${startLeft}px`,
      top: `${startTop}px`,
      transform: "none",
      margin: "0",
    });

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    modalEl.setCssStyles({
      left: `${startLeft + dx}px`,
      top: `${startTop + dy}px`,
    });
  };

  const onMouseUp = () => {
    isDragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };

  dragHandle.addEventListener("mousedown", onMouseDown);
}

export class EditHistoryModal extends Modal {
  private filePath: string;
  private allEntries: DisplayEntry[] = [];

  constructor(app: App, filePath: string) {
    super(app);
    this.filePath = filePath;
  }

  async onOpen() {
    await this.render();
  }

  private async render() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-hub-edit-history-modal");
    modalEl.addClass("llm-hub-modal-resizable");

    const fileName = this.filePath.split("/").pop() || this.filePath;
    const dragHandle = contentEl.createDiv({ cls: "modal-drag-handle" });
    dragHandle.createEl("h2", { text: t("editHistoryModal.title", { file: fileName }) });
    setupDragHandle(dragHandle, modalEl);

    const historyManager = getEditHistoryManager();
    if (!historyManager) {
      contentEl.createEl("p", { text: t("editHistoryModal.notInitialized") });
      return;
    }

    const localHistory = historyManager.getHistory(this.filePath);
    const currentDiff = await historyManager.getDiffFromLastSaved(this.filePath);
    const hasUnsavedChanges = currentDiff && currentDiff.stats.additions + currentDiff.stats.deletions > 0;

    const localDisplayEntries: DisplayEntry[] = localHistory
      .filter(e => e.diff !== "")
      .map(e => ({ ...e, origin: "local" as const }));
    this.allEntries = [...localDisplayEntries];
    this.allEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const totalCount = this.allEntries.length;

    if (totalCount === 0 && !hasUnsavedChanges) {
      const noHistoryEl = contentEl.createDiv({ cls: "llm-hub-edit-history-scroll" });
      noHistoryEl.createEl("p", { text: t("editHistoryModal.noHistory") });
      return;
    }

    const scrollArea = contentEl.createDiv({ cls: "llm-hub-edit-history-scroll" });

    if (hasUnsavedChanges) {
      const currentChangesEl = scrollArea.createDiv({ cls: "llm-hub-edit-history-current-changes" });
      currentChangesEl.createEl("h3", { text: t("editHistoryModal.unsavedChanges") });

      const statsEl = currentChangesEl.createDiv({ cls: "llm-hub-edit-history-stats" });
      statsEl.createSpan({
        cls: "llm-hub-edit-history-additions",
        text: t("diffModal.additions", { count: String(currentDiff.stats.additions) }),
      });
      statsEl.createSpan({
        cls: "llm-hub-edit-history-deletions",
        text: ` ${t("diffModal.deletions", { count: String(currentDiff.stats.deletions) })}`,
      });

      const btnsEl = currentChangesEl.createDiv({ cls: "llm-hub-edit-history-btns" });

      const diffBtn = btnsEl.createEl("button", {
        cls: "llm-hub-edit-history-btn",
        text: t("editHistoryModal.diff"),
      });
      diffBtn.addEventListener("click", () => {
        new CurrentDiffModal(this.app, this.filePath, currentDiff).open();
      });

      const resetBtn = btnsEl.createEl("button", {
        cls: "llm-hub-edit-history-btn-reset",
        text: t("editHistoryModal.revertToBase"),
      });
      resetBtn.addEventListener("click", () => {
        new LocalConfirmModal(this.app, t("editHistoryModal.confirmRevertToBase"), () => {
          void historyManager.revertToBase(this.filePath).then(() => {
            new Notice(t("editHistoryModal.revertedToBase"));
            this.close();
          });
        }).open();
      });
    }

    const timelineEl = scrollArea.createDiv({ cls: "llm-hub-edit-history-timeline" });

    const currentEl = timelineEl.createDiv({ cls: "llm-hub-edit-history-current" });
    currentEl.createSpan({ cls: "llm-hub-edit-history-marker", text: "\u25CF" });
    currentEl.createSpan({ text: ` ${t("editHistoryModal.current")}` });

    for (const entry of this.allEntries) {
      this.renderHistoryEntry(timelineEl, entry);
    }

    this.renderFooter(contentEl, totalCount, historyManager);
  }

  private renderFooter(
    container: HTMLElement,
    totalCount: number,
    historyManager: NonNullable<ReturnType<typeof getEditHistoryManager>>,
  ) {
    const footerEl = container.createDiv({ cls: "llm-hub-edit-history-footer" });

    const leftEl = footerEl.createDiv({ cls: "llm-hub-edit-history-footer-left" });
    leftEl.createSpan({ text: t("editHistoryModal.entriesCount", { count: String(totalCount) }) });

    new Setting(footerEl)
      .addButton((btn) =>
        btn
          .setButtonText(t("editHistoryModal.clearAll"))
          .setWarning()
          .onClick(() => {
            new LocalConfirmModal(this.app, t("editHistoryModal.confirmClear"), async () => {
              let restoredContent: string | null = null;

              const localHistory = historyManager.getHistory(this.filePath);
              if (localHistory.length > 0) {
                restoredContent = historyManager.getContentAt(this.filePath, localHistory[0].id);
              }

              if (restoredContent !== null) {
                const file = this.app.vault.getAbstractFileByPath(this.filePath);
                if (file instanceof TFile) {
                  await this.app.vault.modify(file, restoredContent);
                  historyManager.setSnapshot(this.filePath, restoredContent);
                }
              }

              historyManager.clearHistory(this.filePath);
              this.close();
            }).open();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText(t("editHistoryModal.close"))
          .onClick(() => {
            this.close();
          })
      );
  }

  private renderHistoryEntry(container: HTMLElement, entry: DisplayEntry) {
    const entryEl = container.createDiv({ cls: "llm-hub-edit-history-entry" });

    entryEl.createDiv({ cls: "llm-hub-edit-history-connector" });

    const contentEl = entryEl.createDiv({ cls: "llm-hub-edit-history-entry-content" });

    const date = new Date(entry.timestamp);
    const timeStr = date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const headerEl = contentEl.createDiv({ cls: "llm-hub-edit-history-entry-header" });
    headerEl.createSpan({ cls: "llm-hub-edit-history-time", text: timeStr });

    const sourceLabel = this.getSourceLabel(entry);
    headerEl.createSpan({ cls: "llm-hub-edit-history-source", text: ` ${sourceLabel}` });

    // Local diffs are stored in reverse direction, so swap for display
    const additions = entry.stats.deletions;
    const deletions = entry.stats.additions;
    const statsEl = contentEl.createDiv({ cls: "llm-hub-edit-history-stats" });
    statsEl.createSpan({
      cls: "llm-hub-edit-history-additions",
      text: t("diffModal.additions", { count: String(additions) }),
    });
    statsEl.createSpan({
      cls: "llm-hub-edit-history-deletions",
      text: ` ${t("diffModal.deletions", { count: String(deletions) })}`,
    });

    if (entry.model) {
      contentEl.createDiv({
        cls: "llm-hub-edit-history-model",
        text: entry.model,
      });
    }

    const actionsEl = contentEl.createDiv({ cls: "llm-hub-edit-history-actions" });

    const diffBtn = actionsEl.createEl("button", {
      cls: "llm-hub-edit-history-btn",
      text: t("editHistoryModal.diff"),
    });
    diffBtn.addEventListener("click", () => {
      new DiffModal(
        this.app,
        entry,
        this.filePath,
        () => this.handleRestore(entry),
        (destPath: string) => this.handleCopy(entry, destPath),
      ).open();
    });

    const restoreBtn = actionsEl.createEl("button", {
      cls: "llm-hub-edit-history-btn",
      text: t("editHistoryModal.restore"),
    });
    restoreBtn.addEventListener("click", () => {
      new LocalConfirmModal(this.app, t("editHistoryModal.confirmRestore"), () => {
        void this.handleRestore(entry);
      }).open();
    });

    const copyBtn = actionsEl.createEl("button", {
      cls: "llm-hub-edit-history-btn",
      text: t("editHistoryModal.copy"),
    });
    copyBtn.addEventListener("click", () => {
      const defaultPath = generateCopyFilename(this.filePath);
      new CopyInputModal(this.app, defaultPath, async (destPath: string) => {
        await this.handleCopy(entry, destPath);
      }).open();
    });
  }

  private getSourceLabel(entry: EditHistoryEntry): string {
    if (entry.source === "workflow" && entry.workflowName) {
      return `${t("editHistoryModal.workflow")} "${entry.workflowName}"`;
    }
    switch (entry.source) {
      case "workflow":
        return t("editHistoryModal.workflow");
      case "propose_edit":
        return t("editHistoryModal.proposeEdit");
      case "manual":
        return t("editHistoryModal.manual");
      case "auto":
        return t("editHistoryModal.auto");
      default:
        return entry.source;
    }
  }

  private async getContentAtEntry(targetEntry: DisplayEntry): Promise<string | null> {
    const targetIdx = this.allEntries.indexOf(targetEntry);
    if (targetIdx < 0) {
      return null;
    }

    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) return null;
    const currentContent = await this.app.vault.read(file);

    const entriesToReverse = this.allEntries.slice(0, targetIdx + 1);
    return reconstructContent(currentContent, entriesToReverse);
  }

  private async handleRestore(entry: DisplayEntry) {
    try {
      const content = await this.getContentAtEntry(entry);
      if (content === null) {
        new Notice(t("editHistoryModal.restoreFailed"));
        return;
      }

      const file = this.app.vault.getAbstractFileByPath(this.filePath);
      if (!(file instanceof TFile)) {
        new Notice(t("editHistoryModal.restoreFailed"));
        return;
      }

      await this.app.vault.modify(file, content);

      const historyManager = getEditHistoryManager();
      if (historyManager) {
        historyManager.saveEdit({
          path: this.filePath,
          modifiedContent: content,
          source: "manual",
        });
      }

      const date = new Date(entry.timestamp);
      const timeStr = date.toLocaleString();
      new Notice(t("editHistoryModal.restored", { timestamp: timeStr }));
    } catch (e) {
      console.error("Failed to restore:", formatError(e));
      new Notice(t("editHistoryModal.restoreFailed"));
    } finally {
      this.close();
    }
  }

  private async handleCopy(entry: DisplayEntry, destPath: string) {
    try {
      const content = await this.getContentAtEntry(entry);
      if (content === null) {
        new Notice(t("editHistoryModal.copyFailed"));
        return;
      }

      if (await this.app.vault.adapter.exists(destPath)) {
        new Notice(t("editHistoryModal.fileExists"));
        return;
      }

      const parentPath = destPath.substring(0, destPath.lastIndexOf("/"));
      if (parentPath && !(await this.app.vault.adapter.exists(parentPath))) {
        await this.app.vault.createFolder(parentPath);
      }

      await this.app.vault.create(destPath, content);
      new Notice(t("editHistoryModal.copied", { path: destPath }));
    } catch (e) {
      console.error("Failed to copy:", formatError(e));
      new Notice(t("editHistoryModal.copyFailed"));
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class CurrentDiffModal extends Modal {
  private filePath: string;
  private diffData: { diff: string; stats: { additions: number; deletions: number } };

  constructor(
    app: App,
    filePath: string,
    diffData: { diff: string; stats: { additions: number; deletions: number } }
  ) {
    super(app);
    this.filePath = filePath;
    this.diffData = diffData;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-hub-diff-modal");
    modalEl.addClass("llm-hub-modal-resizable");

    const fileName = this.filePath.split("/").pop() || this.filePath;
    const dragHandle = contentEl.createDiv({ cls: "modal-drag-handle" });
    dragHandle.createEl("h2", { text: t("editHistoryModal.unsavedChanges") + ": " + fileName });
    setupDragHandle(dragHandle, modalEl);

    const statsEl = contentEl.createDiv({ cls: "llm-hub-diff-stats" });
    statsEl.createSpan({
      cls: "llm-hub-diff-additions",
      text: t("diffModal.additions", { count: String(this.diffData.stats.additions) }),
    });
    statsEl.createSpan({
      cls: "llm-hub-diff-deletions",
      text: ` ${t("diffModal.deletions", { count: String(this.diffData.stats.deletions) })}`,
    });

    const diffEl = contentEl.createDiv({ cls: "llm-hub-diff-content" });
    this.renderDiff(diffEl);

    const actionsEl = contentEl.createDiv({ cls: "llm-hub-diff-actions" });
    new Setting(actionsEl)
      .addButton((btn) =>
        btn.setButtonText(t("diffModal.close")).onClick(() => {
          this.close();
        })
      );
  }

  private renderDiff(container: HTMLElement) {
    const preEl = container.createEl("pre", { cls: "llm-hub-diff-pre" });

    const lines = this.diffData.diff.split("\n");
    for (const line of lines) {
      const lineEl = preEl.createDiv({ cls: "llm-hub-diff-line" });

      if (line.startsWith("@@")) {
        lineEl.addClass("llm-hub-diff-hunk");
      } else if (line.startsWith("+")) {
        lineEl.addClass("llm-hub-diff-add");
      } else if (line.startsWith("-")) {
        lineEl.addClass("llm-hub-diff-remove");
      } else {
        lineEl.addClass("llm-hub-diff-context");
      }

      lineEl.textContent = line;
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class DiffModal extends Modal {
  private entry: EditHistoryEntry;
  private filePath: string;
  private onRestore: (() => Promise<void>) | null;
  private onCopy: ((destPath: string) => Promise<void>) | null;

  constructor(
    app: App,
    entry: EditHistoryEntry,
    filePath: string,
    onRestore: (() => Promise<void>) | null,
    onCopy: ((destPath: string) => Promise<void>) | null,
  ) {
    super(app);
    this.entry = entry;
    this.filePath = filePath;
    this.onRestore = onRestore;
    this.onCopy = onCopy;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-hub-diff-modal");
    modalEl.addClass("llm-hub-modal-resizable");

    const date = new Date(this.entry.timestamp);
    const timeStr = date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const sourceLabel = this.getSourceLabel();
    const dragHandle = contentEl.createDiv({ cls: "modal-drag-handle" });
    dragHandle.createEl("h2", {
      text: t("diffModal.title", { timestamp: timeStr, source: sourceLabel }),
    });
    setupDragHandle(dragHandle, modalEl);

    // Local diffs are stored in reverse direction, so swap for display
    const additions = this.entry.stats.deletions;
    const deletions = this.entry.stats.additions;
    const statsEl = contentEl.createDiv({ cls: "llm-hub-diff-stats" });
    statsEl.createSpan({
      cls: "llm-hub-diff-additions",
      text: t("diffModal.additions", { count: String(additions) }),
    });
    statsEl.createSpan({
      cls: "llm-hub-diff-deletions",
      text: ` ${t("diffModal.deletions", { count: String(deletions) })}`,
    });

    const diffEl = contentEl.createDiv({ cls: "llm-hub-diff-content" });
    this.renderDiff(diffEl);

    const actionsEl = contentEl.createDiv({ cls: "llm-hub-diff-actions" });

    const setting = new Setting(actionsEl);
    if (this.onRestore) {
      const restoreFn = this.onRestore;
      setting.addButton((btn) =>
        btn
          .setButtonText(t("diffModal.restoreVersion"))
          .setCta()
          .onClick(() => {
            new LocalConfirmModal(this.app, t("editHistoryModal.confirmRestore"), async () => {
              await restoreFn();
              this.close();
            }).open();
          })
      );
    }
    if (this.onCopy) {
      const copyFn = this.onCopy;
      setting.addButton((btn) =>
        btn
          .setButtonText(t("editHistoryModal.copy"))
          .onClick(() => {
            const defaultPath = generateCopyFilename(this.filePath);
            new CopyInputModal(this.app, defaultPath, async (destPath: string) => {
              await copyFn(destPath);
            }).open();
          })
      );
    }
    setting.addButton((btn) =>
      btn.setButtonText(t("diffModal.close")).onClick(() => {
        this.close();
      })
    );
  }

  private getSourceLabel(): string {
    if (this.entry.source === "workflow" && this.entry.workflowName) {
      return this.entry.workflowName;
    }
    switch (this.entry.source) {
      case "workflow":
        return t("editHistoryModal.workflow");
      case "propose_edit":
        return t("editHistoryModal.proposeEdit");
      case "manual":
        return t("editHistoryModal.manual");
      case "auto":
        return t("editHistoryModal.auto");
      default:
        return this.entry.source;
    }
  }

  private renderDiff(container: HTMLElement) {
    const legendEl = container.createDiv({ cls: "llm-hub-diff-legend" });
    const removedLabel = legendEl.createSpan({ cls: "llm-hub-diff-legend-removed" });
    removedLabel.textContent = `\u2212 ${t("diffModal.before")}`;
    const addedLabel = legendEl.createSpan({ cls: "llm-hub-diff-legend-added" });
    addedLabel.textContent = `+ ${t("diffModal.after")}`;

    const preEl = container.createEl("pre", { cls: "llm-hub-diff-pre" });

    // Local diffs are stored in reverse direction (new->old),
    // swap +/- to normalize display to forward direction (old->new)
    const lines = this.entry.diff.split("\n");
    for (const line of lines) {
      const lineEl = preEl.createDiv({ cls: "llm-hub-diff-line" });

      if (line.startsWith("@@")) {
        lineEl.addClass("llm-hub-diff-hunk");
        lineEl.textContent = line;
      } else if (line.startsWith("+")) {
        lineEl.addClass("llm-hub-diff-remove");
        lineEl.textContent = "-" + line.slice(1);
      } else if (line.startsWith("-")) {
        lineEl.addClass("llm-hub-diff-add");
        lineEl.textContent = "+" + line.slice(1);
      } else {
        lineEl.addClass("llm-hub-diff-context");
        lineEl.textContent = line;
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
