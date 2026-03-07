import { StateField, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type { MarkdownView } from "obsidian";

const selectionHighlightMark = Decoration.mark({ class: "llm-hub-selection-highlight" });

export const setSelectionHighlight = StateEffect.define<{ from: number; to: number } | null>();

export const selectionHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setSelectionHighlight)) {
        if (effect.value === null) {
          decorations = Decoration.none;
        } else {
          const { from, to } = effect.value;
          decorations = Decoration.set([selectionHighlightMark.range(from, to)]);
        }
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface SelectionHighlightInfo {
  view: MarkdownView;
  from: number;
  to: number;
}

export interface SelectionLocationInfo {
  filePath: string;
  startLine: number;
  endLine: number;
  start: number;
  end: number;
}
