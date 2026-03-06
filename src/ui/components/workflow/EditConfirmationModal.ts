import { Modal, App, MarkdownRenderer, Component } from "obsidian";
import { t } from "src/i18n";

/**
 * Diff line types
 */
export type DiffLineType = "unchanged" | "added" | "removed";

/**
 * Represents a single line in the diff output
 */
export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

/**
 * Calculate line-based diff between two strings using LCS algorithm
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to get diff
  let i = m;
  let j = n;
  const diffStack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffStack.push({
        type: "unchanged",
        content: oldLines[i - 1],
        oldLineNum: i,
        newLineNum: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      diffStack.push({
        type: "added",
        content: newLines[j - 1],
        newLineNum: j,
      });
      j--;
    } else {
      diffStack.push({
        type: "removed",
        content: oldLines[i - 1],
        oldLineNum: i,
      });
      i--;
    }
  }

  // Reverse to get correct order
  while (diffStack.length > 0) {
    result.push(diffStack.pop()!);
  }

  return result;
}

/**
 * Modal for confirming file edits before writing
 * Shows file path, mode, and content preview with diff
 * Resizable and draggable
 */
export class EditConfirmationModal extends Modal {
  private filePath: string;
  private content: string;
  private originalContent: string;
  private mode: string;
  private resolvePromise: ((value: { action: "save" | "cancel" | "edit"; content?: string }) => void) | null = null;
  private component: Component;
  private isShowingAdditionalRequest = false;
  private additionalRequestEl: HTMLTextAreaElement | null = null;
  private requestChangesBtn: HTMLButtonElement | null = null;

  // Drag state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private modalStartX = 0;
  private modalStartY = 0;

  // Resize state
  private isResizing = false;
  private resizeDirection = "";
  private resizeStartWidth = 0;
  private resizeStartHeight = 0;

  constructor(app: App, filePath: string, content: string, mode: string, originalContent?: string) {
    super(app);
    this.filePath = filePath;
    this.content = content;
    this.originalContent = originalContent || "";
    this.mode = mode;
    this.component = new Component();
  }

  onOpen() {
    const { contentEl, modalEl, containerEl } = this;

    // Prevent closing on outside click
    containerEl.setCssProps({ "pointer-events": "none" });
    modalEl.setCssProps({ "pointer-events": "auto" });

    // Add modal classes for styling
    modalEl.addClass("llm-hub-workflow-confirm-modal");
    modalEl.addClass("llm-hub-workflow-confirm-resizable");

    // Header (drag handle)
    const header = contentEl.createDiv({
      cls: "llm-hub-workflow-confirm-header llm-hub-workflow-confirm-drag-handle",
    });

    const titleRow = header.createDiv({ cls: "llm-hub-workflow-confirm-title-row" });
    titleRow.createEl("h3", { text: t("workflowConfirm.title") });

    const modeLabel = this.getModeLabel();
    titleRow.createEl("span", {
      text: modeLabel,
      cls: "llm-hub-workflow-confirm-mode",
    });

    // File path display
    const pathRow = header.createDiv({ cls: "llm-hub-workflow-confirm-path" });
    pathRow.createEl("span", { text: t("workflowConfirm.file") });
    pathRow.createEl("strong", { text: this.filePath });

    // Content preview
    const previewContainer = contentEl.createDiv({
      cls: "llm-hub-workflow-confirm-preview",
    });

    const previewLabel = previewContainer.createDiv({
      cls: "llm-hub-workflow-confirm-preview-label",
    });
    previewLabel.createEl("span", { text: t("workflowConfirm.changes") });

    const previewContent = previewContainer.createDiv({
      cls: "llm-hub-workflow-confirm-preview-content",
    });

    // Render diff view if we have original content, otherwise render markdown preview
    this.component.load();
    if (this.originalContent || this.mode === "create") {
      // For new files or when we have original content, show diff
      const diffLines = computeLineDiff(this.originalContent, this.content);
      const diffContainer = previewContent.createDiv({ cls: "llm-hub-workflow-confirm-diff-view" });

      for (const line of diffLines) {
        const lineEl = diffContainer.createDiv({
          cls: `llm-hub-workflow-confirm-diff-line llm-hub-workflow-confirm-diff-${line.type}`,
        });

        // Line number gutter
        const gutterEl = lineEl.createSpan({ cls: "llm-hub-workflow-confirm-diff-gutter" });
        if (line.type === "removed") {
          gutterEl.textContent = "-";
        } else if (line.type === "added") {
          gutterEl.textContent = "+";
        } else {
          gutterEl.textContent = " ";
        }

        // Line content
        const lineContentEl = lineEl.createSpan({ cls: "llm-hub-workflow-confirm-diff-content" });
        lineContentEl.textContent = line.content || " "; // Empty lines show space
      }
    } else {
      // Fallback to markdown preview if no original content
      void MarkdownRenderer.render(
        this.app,
        this.content,
        previewContent,
        "",
        this.component
      );
    }

    // Additional request textarea (hidden initially)
    const additionalRequestContainer = contentEl.createDiv({
      cls: "llm-hub-workflow-confirm-additional-container llm-hub-hidden",
    });

    additionalRequestContainer.createEl("label", {
      text: t("workflowConfirm.editPlaceholder"),
      cls: "llm-hub-workflow-confirm-additional-label",
    });

    this.additionalRequestEl = additionalRequestContainer.createEl("textarea", {
      cls: "llm-hub-workflow-confirm-additional-input",
      placeholder: t("workflowConfirm.editPlaceholder"),
    });
    this.additionalRequestEl.rows = 3;

    // Action buttons
    const actions = contentEl.createDiv({
      cls: "llm-hub-workflow-confirm-actions",
    });

    const cancelBtn = actions.createEl("button", { text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => {
      this.resolvePromise?.({ action: "cancel" });
      this.close();
    });

    this.requestChangesBtn = actions.createEl("button", {
      text: t("workflowConfirm.edit"),
      cls: "mod-warning",
    });
    this.requestChangesBtn.addEventListener("click", () => {
      if (this.isShowingAdditionalRequest) {
        // Second click: submit with additional request content
        const additionalRequest = this.additionalRequestEl?.value || "";
        this.resolvePromise?.({
          action: "edit",
          content: additionalRequest,
        });
        this.close();
      } else {
        // First click: show textarea
        this.isShowingAdditionalRequest = true;
        additionalRequestContainer.removeClass("llm-hub-hidden");
        if (this.requestChangesBtn) {
          this.requestChangesBtn.textContent = t("workflowConfirm.sendEdit");
        }
        this.additionalRequestEl?.focus();
      }
    });

    const confirmBtn = actions.createEl("button", {
      text: t("workflowConfirm.save"),
      cls: "mod-cta",
    });
    confirmBtn.addEventListener("click", () => {
      this.resolvePromise?.({ action: "save" });
      this.close();
    });

    // Add resize handles
    this.addResizeHandles(modalEl);

    // Setup drag functionality
    this.setupDrag(header, modalEl);
  }

  private getModeLabel(): string {
    switch (this.mode) {
      case "create":
        return t("workflowConfirm.createNewFile");
      case "append":
        return t("workflowConfirm.appendToFile");
      case "overwrite":
        return t("workflowConfirm.overwriteFile");
      default:
        return this.mode;
    }
  }

  private addResizeHandles(modalEl: HTMLElement) {
    const directions = ["n", "e", "s", "w", "ne", "nw", "se", "sw"];
    for (const dir of directions) {
      const handle = document.createElement("div");
      handle.className = `llm-hub-workflow-confirm-resize-handle llm-hub-workflow-confirm-resize-${dir}`;
      handle.dataset.direction = dir;
      modalEl.appendChild(handle);
      this.setupResize(handle, modalEl, dir);
    }
  }

  private setupDrag(header: HTMLElement, modalEl: HTMLElement) {
    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") return;

      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;

      const rect = modalEl.getBoundingClientRect();
      this.modalStartX = rect.left;
      this.modalStartY = rect.top;

      modalEl.setCssProps({
        position: "fixed",
        margin: "0",
        transform: "none",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
      });

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging) return;

      const deltaX = e.clientX - this.dragStartX;
      const deltaY = e.clientY - this.dragStartY;

      modalEl.setCssProps({
        left: `${this.modalStartX + deltaX}px`,
        top: `${this.modalStartY + deltaY}px`,
      });
    };

    const onMouseUp = () => {
      this.isDragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    header.addEventListener("mousedown", onMouseDown);
  }

  private setupResize(handle: HTMLElement, modalEl: HTMLElement, direction: string) {
    const onMouseDown = (e: MouseEvent) => {
      this.isResizing = true;
      this.resizeDirection = direction;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;

      const rect = modalEl.getBoundingClientRect();
      this.resizeStartWidth = rect.width;
      this.resizeStartHeight = rect.height;
      this.modalStartX = rect.left;
      this.modalStartY = rect.top;

      modalEl.setCssProps({
        position: "fixed",
        margin: "0",
        transform: "none",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
      e.stopPropagation();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isResizing) return;

      const deltaX = e.clientX - this.dragStartX;
      const deltaY = e.clientY - this.dragStartY;
      const dir = this.resizeDirection;

      let newWidth = this.resizeStartWidth;
      let newHeight = this.resizeStartHeight;
      let newLeft = this.modalStartX;
      let newTop = this.modalStartY;

      if (dir.includes("e")) {
        newWidth = Math.max(400, this.resizeStartWidth + deltaX);
      }
      if (dir.includes("w")) {
        newWidth = Math.max(400, this.resizeStartWidth - deltaX);
        newLeft = this.modalStartX + (this.resizeStartWidth - newWidth);
      }
      if (dir.includes("s")) {
        newHeight = Math.max(300, this.resizeStartHeight + deltaY);
      }
      if (dir.includes("n")) {
        newHeight = Math.max(300, this.resizeStartHeight - deltaY);
        newTop = this.modalStartY + (this.resizeStartHeight - newHeight);
      }

      modalEl.setCssProps({
        width: `${newWidth}px`,
        height: `${newHeight}px`,
        left: `${newLeft}px`,
        top: `${newTop}px`,
      });
    };

    const onMouseUp = () => {
      this.isResizing = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    handle.addEventListener("mousedown", onMouseDown);
  }

  onClose() {
    this.component.unload();
    this.contentEl.empty();
    // If closed without clicking a button, treat as cancel
    this.resolvePromise?.({ action: "cancel" });
  }

  /**
   * Open the modal and wait for user response
   */
  openAndWait(): Promise<{ action: "save" | "cancel" | "edit"; content?: string }> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }
}

/**
 * Helper function to prompt for confirmation
 * @param app - Obsidian App instance
 * @param filePath - Target file path
 * @param content - Content to be written
 * @param mode - Write mode (create, append, overwrite)
 * @param originalContent - Original content for diff display (optional)
 * @returns Promise with action and optional content for edit requests
 */
export function promptForConfirmation(
  app: App,
  filePath: string,
  content: string,
  mode: string,
  originalContent?: string
): Promise<{ action: "save" | "cancel" | "edit"; content?: string }> {
  const modal = new EditConfirmationModal(app, filePath, content, mode, originalContent);
  return modal.openAndWait();
}
