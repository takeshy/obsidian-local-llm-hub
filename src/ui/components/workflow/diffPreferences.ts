import type { App } from "obsidian";
import type { DiffViewMode } from "./DiffRenderer";

const VIEW_MODE_KEY = "local-llm-hub-diff-view-mode";
const FULLSCREEN_KEY = "local-llm-hub-diff-fullscreen";
const OPEN_FILE_KEY = "local-llm-hub-open-file-after-apply";

export function getDiffViewMode(app: App): DiffViewMode {
  return app.loadLocalStorage(VIEW_MODE_KEY) === "split" ? "split" : "unified";
}

export function setDiffViewMode(app: App, mode: DiffViewMode): void {
  app.saveLocalStorage(VIEW_MODE_KEY, mode);
}

function getBoolean(app: App, key: string, fallback: boolean): boolean {
  const value: unknown = app.loadLocalStorage(key);
  if (value === undefined || value === null) return fallback;
  return value === true || value === "true";
}

function setBoolean(app: App, key: string, value: boolean): void {
  app.saveLocalStorage(key, value ? "true" : "false");
}

export const getDiffFullscreen = (app: App) => getBoolean(app, FULLSCREEN_KEY, false);
export const setDiffFullscreen = (app: App, value: boolean) => setBoolean(app, FULLSCREEN_KEY, value);
export const getOpenFileAfterApply = (app: App) => getBoolean(app, OPEN_FILE_KEY, false);
export const setOpenFileAfterApply = (app: App, value: boolean) => setBoolean(app, OPEN_FILE_KEY, value);
