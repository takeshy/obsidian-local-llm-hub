import { MarkdownView } from "obsidian";
import { EditorView } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import {
  selectionHighlightField,
  setSelectionHighlight,
  type SelectionHighlightInfo,
  type SelectionLocationInfo,
} from "src/ui/selectionHighlight";
import type { LocalLlmHubPlugin } from "src/plugin";

export class SelectionManager {
  private plugin: LocalLlmHubPlugin;
  private lastSelection = "";
  private selectionHighlight: SelectionHighlightInfo | null = null;
  private selectionLocation: SelectionLocationInfo | null = null;

  constructor(plugin: LocalLlmHubPlugin) {
    this.plugin = plugin;
  }

  captureSelectionFromView(view: MarkdownView | null): void {
    this.clearSelectionHighlight();
    this.selectionLocation = null;

    if (!view?.editor) {
      this.captureSelection();
      return;
    }

    const editor = view.editor;
    const selection = editor.getSelection();
    if (selection) {
      this.lastSelection = selection;
      const fromPos = editor.getCursor("from");
      const toPos = editor.getCursor("to");
      const from = editor.posToOffset(fromPos);
      const to = editor.posToOffset(toPos);
      this.applySelectionHighlight(view, from, to);
      const file = view.file;
      if (file) {
        this.selectionLocation = {
          filePath: file.path,
          startLine: fromPos.line + 1,
          endLine: toPos.line + 1,
          start: from,
          end: to,
        };
      }
    }
  }

  captureSelection(): void {
    this.clearSelectionHighlight();
    this.selectionLocation = null;

    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      const editor = activeView.editor;
      const selection = editor.getSelection();
      if (selection) {
        this.lastSelection = selection;
        const fromPos = editor.getCursor("from");
        const toPos = editor.getCursor("to");
        const from = editor.posToOffset(fromPos);
        const to = editor.posToOffset(toPos);
        this.applySelectionHighlight(activeView, from, to);
        const file = activeView.file;
        if (file) {
          this.selectionLocation = {
            filePath: file.path,
            startLine: fromPos.line + 1,
            endLine: toPos.line + 1,
            start: from,
            end: to,
          };
        }
        return;
      }
    }

    // Fallback: search all markdown leaves
    const leaves = this.plugin.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view as MarkdownView;
      if (view?.editor) {
        const editor = view.editor;
        const selection = editor.getSelection();
        if (selection) {
          this.lastSelection = selection;
          const fromPos = editor.getCursor("from");
          const toPos = editor.getCursor("to");
          const from = editor.posToOffset(fromPos);
          const to = editor.posToOffset(toPos);
          this.applySelectionHighlight(view, from, to);
          const file = view.file;
          if (file) {
            this.selectionLocation = {
              filePath: file.path,
              startLine: fromPos.line + 1,
              endLine: toPos.line + 1,
              start: from,
              end: to,
            };
          }
          return;
        }
      }
    }
  }

  private applySelectionHighlight(view: MarkdownView, from: number, to: number): void {
    try {
      // @ts-expect-error - Obsidian's editor.cm is the CodeMirror EditorView
      const editorView = view.editor.cm as EditorView;
      if (!editorView) return;

      const hasField = editorView.state.field(selectionHighlightField, false) !== undefined;
      if (!hasField) {
        editorView.dispatch({
          effects: StateEffect.appendConfig.of([selectionHighlightField]),
        });
      }

      editorView.dispatch({
        effects: setSelectionHighlight.of({ from, to }),
      });

      this.selectionHighlight = { view, from, to };
    } catch {
      // Highlight is optional
    }
  }

  clearSelectionHighlight(): void {
    if (!this.selectionHighlight) return;

    try {
      const { view } = this.selectionHighlight;
      // @ts-expect-error - Obsidian's editor.cm is the CodeMirror EditorView
      const editorView = view.editor?.cm as EditorView;
      if (editorView) {
        const hasField = editorView.state.field(selectionHighlightField, false) !== undefined;
        if (hasField) {
          editorView.dispatch({
            effects: setSelectionHighlight.of(null),
          });
        }
      }
    } catch {
      // Ignore errors
    }

    this.selectionHighlight = null;
  }

  getLastSelection(): string {
    return this.lastSelection;
  }

  getSelectionLocation(): SelectionLocationInfo | null {
    return this.selectionLocation;
  }

  clearLastSelection(): void {
    this.lastSelection = "";
    this.selectionLocation = null;
    this.clearSelectionHighlight();
  }
}
