import * as Diff from "diff";
import { computeLineDiff, type DiffLine, type DiffLineType } from "./EditConfirmationModal";
import { t } from "src/i18n";

export { type DiffLine, type DiffLineType };

export type DiffViewMode = "unified" | "split";

export interface DiffRenderOptions {
  viewMode: DiffViewMode;
  enableComments: boolean;
}

export interface LineComment {
  lineIndex: number;
  lineType: DiffLineType;
  lineNum: number;
  content: string;
  comment: string;
}

export interface DiffRendererState {
  container: HTMLElement;
  viewMode: DiffViewMode;
  lineComments: Map<number, LineComment>;
  onCommentsChange: (() => void) | null;
  setViewMode: (mode: DiffViewMode) => void;
  destroy: () => void;
}

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
  leftIndex: number;
  rightIndex: number;
}

interface LinePair {
  removedIndex: number;
  addedIndex: number;
  removedContent: string;
  addedContent: string;
  wordChanges: Diff.Change[];
}

function buildLinePairs(diffLines: DiffLine[]): Map<number, LinePair> {
  const pairs = new Map<number, LinePair>();
  let i = 0;
  while (i < diffLines.length) {
    if (diffLines[i].type === "removed") {
      const removed: { index: number; line: DiffLine }[] = [];
      const added: { index: number; line: DiffLine }[] = [];
      while (i < diffLines.length && diffLines[i].type === "removed") {
        removed.push({ index: i, line: diffLines[i] });
        i++;
      }
      while (i < diffLines.length && diffLines[i].type === "added") {
        added.push({ index: i, line: diffLines[i] });
        i++;
      }
      const pairCount = Math.min(removed.length, added.length);
      for (let j = 0; j < pairCount; j++) {
        const removedContent = removed[j].line.content;
        const addedContent = added[j].line.content;
        // Compute word-level diff once per pair; renderWordDiff reuses the
        // result for both sides of unified/split view.
        const wordChanges = Diff.diffWords(removedContent, addedContent);
        const pair: LinePair = {
          removedIndex: removed[j].index,
          addedIndex: added[j].index,
          removedContent,
          addedContent,
          wordChanges,
        };
        pairs.set(removed[j].index, pair);
        pairs.set(added[j].index, pair);
      }
    } else {
      i++;
    }
  }
  return pairs;
}

function renderWordDiff(
  contentEl: HTMLElement,
  changes: Diff.Change[],
  side: "old" | "new"
): void {
  for (const change of changes) {
    if (change.added) {
      if (side === "new") {
        const span = contentEl.createSpan({ cls: "llm-hub-diff-word-added" });
        span.textContent = change.value;
      }
    } else if (change.removed) {
      if (side === "old") {
        const span = contentEl.createSpan({ cls: "llm-hub-diff-word-removed" });
        span.textContent = change.value;
      }
    } else {
      const span = contentEl.createSpan();
      span.textContent = change.value;
    }
  }
}

function pairLinesForSplitView(diffLines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < diffLines.length) {
    if (diffLines[i].type === "unchanged") {
      rows.push({ left: diffLines[i], right: diffLines[i], leftIndex: i, rightIndex: i });
      i++;
    } else {
      const removed: { index: number; line: DiffLine }[] = [];
      const added: { index: number; line: DiffLine }[] = [];
      while (i < diffLines.length && diffLines[i].type === "removed") {
        removed.push({ index: i, line: diffLines[i] });
        i++;
      }
      while (i < diffLines.length && diffLines[i].type === "added") {
        added.push({ index: i, line: diffLines[i] });
        i++;
      }
      const maxLen = Math.max(removed.length, added.length);
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          left: j < removed.length ? removed[j].line : null,
          right: j < added.length ? added[j].line : null,
          leftIndex: j < removed.length ? removed[j].index : -1,
          rightIndex: j < added.length ? added[j].index : -1,
        });
      }
    }
  }
  return rows;
}

function appendCommentPreview(parent: HTMLElement, comment: string): void {
  const commentPreview = parent.createDiv({ cls: "llm-hub-diff-comment-preview" });
  const commentText = commentPreview.createSpan();
  commentText.textContent = comment;
}

function renderUnifiedView(
  container: HTMLElement,
  diffLines: DiffLine[],
  linePairs: Map<number, LinePair>,
  enableComments: boolean,
  lineComments: Map<number, LineComment>,
  openCommentEditor: ((lineIndex: number, afterEl: HTMLElement) => void) | null
): void {
  container.addClass("llm-hub-diff-unified");
  container.removeClass("llm-hub-diff-split");

  for (let idx = 0; idx < diffLines.length; idx++) {
    const line = diffLines[idx];
    const lineEl = container.createDiv({
      cls: `llm-hub-diff-line llm-hub-diff-${line.type}`,
    });

    if (lineComments.has(idx)) {
      lineEl.addClass("llm-hub-diff-has-comment");
    }

    const oldNumEl = lineEl.createSpan({ cls: "llm-hub-diff-linenum llm-hub-diff-linenum-old" });
    oldNumEl.textContent = line.oldLineNum != null ? String(line.oldLineNum) : "";

    const newNumEl = lineEl.createSpan({ cls: "llm-hub-diff-linenum llm-hub-diff-linenum-new" });
    newNumEl.textContent = line.newLineNum != null ? String(line.newLineNum) : "";

    const gutterEl = lineEl.createSpan({ cls: "llm-hub-diff-gutter" });
    if (line.type === "removed") {
      gutterEl.textContent = "-";
    } else if (line.type === "added") {
      gutterEl.textContent = "+";
    } else {
      gutterEl.textContent = " ";
    }

    const contentEl = lineEl.createSpan({ cls: "llm-hub-diff-content" });
    const pair = linePairs.get(idx);
    if (pair && line.type === "removed") {
      renderWordDiff(contentEl, pair.wordChanges, "old");
    } else if (pair && line.type === "added") {
      renderWordDiff(contentEl, pair.wordChanges, "new");
    } else {
      contentEl.textContent = line.content || " ";
    }

    if (enableComments && line.type !== "unchanged" && openCommentEditor) {
      lineEl.addClass("llm-hub-diff-commentable");
      lineEl.addEventListener("click", (e) => {
        // Ignore clicks inside an open editor so its own buttons work.
        if ((e.target as HTMLElement).closest(".llm-hub-diff-comment-editor")) return;
        openCommentEditor(idx, lineEl);
      });
    }

    if (lineComments.has(idx)) {
      appendCommentPreview(container, lineComments.get(idx)!.comment);
    }
  }
}

function renderSplitView(
  container: HTMLElement,
  diffLines: DiffLine[],
  linePairs: Map<number, LinePair>,
  enableComments: boolean,
  lineComments: Map<number, LineComment>,
  openCommentEditor: ((lineIndex: number, afterEl: HTMLElement) => void) | null
): void {
  container.addClass("llm-hub-diff-split");
  container.removeClass("llm-hub-diff-unified");

  const rows = pairLinesForSplitView(diffLines);

  for (const row of rows) {
    const rowEl = container.createDiv({ cls: "llm-hub-diff-split-row" });

    const leftEl = rowEl.createDiv({
      cls: `llm-hub-diff-split-cell llm-hub-diff-split-left ${row.left ? `llm-hub-diff-${row.left.type}` : "llm-hub-diff-split-filler"}`,
    });
    if (row.left) {
      if (lineComments.has(row.leftIndex)) {
        leftEl.addClass("llm-hub-diff-has-comment");
      }
      const lineNumEl = leftEl.createSpan({ cls: "llm-hub-diff-linenum" });
      lineNumEl.textContent = row.left.oldLineNum != null ? String(row.left.oldLineNum) : "";

      const gutterEl = leftEl.createSpan({ cls: "llm-hub-diff-gutter" });
      gutterEl.textContent = row.left.type === "removed" ? "-" : " ";

      const contentEl = leftEl.createSpan({ cls: "llm-hub-diff-content" });
      const pair = linePairs.get(row.leftIndex);
      if (pair && row.left.type === "removed") {
        renderWordDiff(contentEl, pair.wordChanges, "old");
      } else {
        contentEl.textContent = row.left.content || " ";
      }

      if (enableComments && row.left.type === "removed" && openCommentEditor) {
        leftEl.addClass("llm-hub-diff-commentable");
        const capturedIndex = row.leftIndex;
        leftEl.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest(".llm-hub-diff-comment-editor")) return;
          openCommentEditor(capturedIndex, rowEl);
        });
      }
    }

    const rightEl = rowEl.createDiv({
      cls: `llm-hub-diff-split-cell llm-hub-diff-split-right ${row.right ? `llm-hub-diff-${row.right.type}` : "llm-hub-diff-split-filler"}`,
    });
    if (row.right) {
      if (lineComments.has(row.rightIndex)) {
        rightEl.addClass("llm-hub-diff-has-comment");
      }
      const lineNumEl = rightEl.createSpan({ cls: "llm-hub-diff-linenum" });
      lineNumEl.textContent = row.right.newLineNum != null ? String(row.right.newLineNum) : "";

      const gutterEl = rightEl.createSpan({ cls: "llm-hub-diff-gutter" });
      gutterEl.textContent = row.right.type === "added" ? "+" : " ";

      const contentEl = rightEl.createSpan({ cls: "llm-hub-diff-content" });
      const pair = linePairs.get(row.rightIndex);
      if (pair && row.right.type === "added") {
        renderWordDiff(contentEl, pair.wordChanges, "new");
      } else {
        contentEl.textContent = row.right.content || " ";
      }

      if (enableComments && row.right.type === "added" && openCommentEditor) {
        rightEl.addClass("llm-hub-diff-commentable");
        const capturedIndex = row.rightIndex;
        rightEl.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest(".llm-hub-diff-comment-editor")) return;
          openCommentEditor(capturedIndex, rowEl);
        });
      }
    }

    // Append comment previews directly under the row so they track their line
    // instead of stacking at the bottom of the container.
    const commentIndices = [row.leftIndex, row.rightIndex].filter(
      (idx) => idx >= 0 && lineComments.has(idx)
    );
    for (const idx of commentIndices) {
      appendCommentPreview(container, lineComments.get(idx)!.comment);
    }
  }
}

function createCommentEditor(
  diffLines: DiffLine[],
  lineIndex: number,
  afterEl: HTMLElement,
  lineComments: Map<number, LineComment>,
  onSave: () => void
): void {
  const existing = afterEl.parentElement?.querySelector(".llm-hub-diff-comment-editor");
  if (existing) {
    existing.remove();
  }

  const line = diffLines[lineIndex];
  const existingComment = lineComments.get(lineIndex);

  const editor = activeDocument.createDocumentFragment().createDiv({ cls: "llm-hub-diff-comment-editor" });
  afterEl.insertAdjacentElement("afterend", editor);

  const textarea = editor.createEl("textarea", { cls: "llm-hub-diff-comment-input" });
  textarea.placeholder = t("diff.commentPlaceholder");
  textarea.rows = 2;
  if (existingComment) {
    textarea.value = existingComment.comment;
  }
  // Prevent clicks inside the editor from reopening the diff-line click handler.
  editor.addEventListener("click", (e) => e.stopPropagation());

  const actions = editor.createDiv({ cls: "llm-hub-diff-comment-actions" });

  const saveBtn = actions.createEl("button", { text: t("diff.saveComment"), cls: "mod-cta" });
  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const text = textarea.value.trim();
    if (text) {
      lineComments.set(lineIndex, {
        lineIndex,
        lineType: line.type,
        lineNum: (line.type === "removed" ? line.oldLineNum : line.newLineNum) ?? 0,
        content: line.content,
        comment: text,
      });
    } else if (existingComment) {
      // Empty text on an existing comment = delete.
      lineComments.delete(lineIndex);
    }
    editor.remove();
    onSave();
  });

  const cancelBtn = actions.createEl("button", { text: t("diff.cancelComment") });
  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    editor.remove();
  });

  if (existingComment) {
    const removeBtn = actions.createEl("button", { text: t("diff.removeComment"), cls: "mod-warning" });
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      lineComments.delete(lineIndex);
      editor.remove();
      onSave();
    });
  }

  textarea.focus();
}

export function renderDiffView(
  parentEl: HTMLElement,
  oldText: string,
  newText: string,
  options?: Partial<DiffRenderOptions>
): DiffRendererState {
  const opts: DiffRenderOptions = {
    viewMode: options?.viewMode ?? "split",
    enableComments: options?.enableComments ?? false,
  };

  const diffLines = computeLineDiff(oldText, newText);
  const linePairs = buildLinePairs(diffLines);
  const lineComments = new Map<number, LineComment>();

  const container = parentEl.createDiv({ cls: "llm-hub-diff-view" });

  const openCommentEditor = opts.enableComments
    ? (lineIndex: number, afterEl: HTMLElement) => {
        createCommentEditor(diffLines, lineIndex, afterEl, lineComments, () => {
          rerender();
          state.onCommentsChange?.();
        });
      }
    : null;

  function rerender() {
    container.empty();
    container.className = "llm-hub-diff-view";
    if (state.viewMode === "unified") {
      renderUnifiedView(container, diffLines, linePairs, opts.enableComments, lineComments, openCommentEditor);
    } else {
      renderSplitView(container, diffLines, linePairs, opts.enableComments, lineComments, openCommentEditor);
    }
  }

  const state: DiffRendererState = {
    container,
    viewMode: opts.viewMode,
    lineComments,
    onCommentsChange: null,
    setViewMode(mode: DiffViewMode) {
      if (state.viewMode === mode) return;
      state.viewMode = mode;
      rerender();
    },
    destroy() {
      container.remove();
    },
  };

  rerender();

  return state;
}

export function formatLineComments(
  filePath: string,
  lineComments: Map<number, LineComment>
): string {
  if (lineComments.size === 0) return "";

  const lines: string[] = [`File: ${filePath}`, ""];

  const sorted = [...lineComments.values()].sort((a, b) => a.lineIndex - b.lineIndex);

  for (const lc of sorted) {
    const prefix = lc.lineType === "removed" ? "-" : "+";
    lines.push(`Line ${lc.lineNum} (${prefix}): \`${lc.content.trim()}\``);
    lines.push(`Comment: ${lc.comment}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function createDiffViewToggle(
  parentEl: HTMLElement,
  state: DiffRendererState
): void {
  const toggle = parentEl.createDiv({ cls: "llm-hub-diff-view-toggle" });
  const unifiedBtn = toggle.createEl("button", {
    text: t("diff.unifiedView"),
    cls: "llm-hub-diff-view-toggle-btn",
  });
  const splitBtn = toggle.createEl("button", {
    text: t("diff.splitView"),
    cls: "llm-hub-diff-view-toggle-btn",
  });

  const syncActive = () => {
    unifiedBtn.toggleClass("is-active", state.viewMode === "unified");
    splitBtn.toggleClass("is-active", state.viewMode === "split");
  };

  unifiedBtn.addEventListener("click", () => {
    state.setViewMode("unified");
    syncActive();
  });
  splitBtn.addEventListener("click", () => {
    state.setViewMode("split");
    syncActive();
  });

  syncActive();
}
