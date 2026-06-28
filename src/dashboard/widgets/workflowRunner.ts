// Workflow widget execution + sidecar result cache.
//
// EXECUTION MODEL (ported from gemihub): the widget render path reads ONLY from
// the sidecar cache and never executes. Execution is triggered explicitly by the
// refresh button, the config editor's test-run, or the interval auto-run (a
// stale-on-open check plus a recurring timer while the dashboard view is open).
// The cache lives in a normal synced data file under Dashboards/Data so results
// survive reopen without bloating the `.dashboard` file.

import { TFile, type App } from "obsidian";
import type { LocalLlmHubPlugin } from "src/plugin";
import { parseWorkflowFromMarkdown } from "src/workflow/parser";
import { WorkflowExecutor } from "src/workflow/executor";
import type { PromptCallbacks, WorkflowInput } from "src/workflow/types";
import { ensureVaultFolder } from "../dashboardFile";
import { DASHBOARD_FOLDER } from "../types";

export interface WorkflowCacheRecord {
  ranAt: number;
  status: "ok" | "error";
  /** markdown/html output text. */
  text?: string;
  error?: string;
}

/**
 * Headless prompt callbacks: a dashboard run has no UI, so interactive prompts
 * resolve to null (their nodes then fail with a clear message). Edit
 * confirmations are declined: a headless run must not silently write to the
 * vault unless the workflow author explicitly disables confirmation.
 */
function headlessCallbacks(): PromptCallbacks {
  return {
    promptForFile: () => Promise.resolve(null),
    promptForAnyFile: () => Promise.resolve(null),
    promptForNewFilePath: () => Promise.resolve(null),
    promptForSelection: () => Promise.resolve(null),
    promptForValue: () => Promise.resolve(null),
    promptForConfirmation: () => Promise.resolve({ action: "cancel" as const }),
    promptForDialog: () => Promise.resolve(null),
    promptForPassword: () => Promise.resolve(null),
  };
}

/**
 * Extract a string output (markdown / html) from the execution result.
 * Prefers the named output variable, then `result`, then the first non-`_`
 * string variable. Objects/arrays are not valid string output.
 */
export function extractString(
  variables: Map<string, string | number>,
  outputVariable?: string,
): string | null {
  const toStr = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return null;
  };

  if (outputVariable) return toStr(variables.get(outputVariable));

  const fromResult = toStr(variables.get("result"));
  if (fromResult != null) return fromResult;

  for (const [key, value] of variables) {
    if (key.startsWith("_")) continue;
    const s = toStr(value);
    if (s != null && s.length > 0) return s;
  }
  return null;
}

/** Resolve a workflow file by exact vault path only. */
export function resolveWorkflowFile(app: App, workflowPath: string): TFile | null {
  if (!workflowPath) return null;
  const direct = app.vault.getAbstractFileByPath(workflowPath);
  return direct instanceof TFile ? direct : null;
}

/**
 * Execute a workflow headlessly and return its string output. Only call from an
 * explicit user action (refresh / test-run) or the interval auto-run.
 */
export async function runWorkflowText(
  plugin: LocalLlmHubPlugin,
  workflowPath: string,
  outputVariable: string | undefined,
  abortSignal: AbortSignal,
): Promise<string> {
  const file = resolveWorkflowFile(plugin.app, workflowPath);
  if (!file) throw new Error(`Workflow not found: ${workflowPath}`);

  const content = await plugin.app.vault.read(file);
  const workflow = parseWorkflowFromMarkdown(content);

  const executor = new WorkflowExecutor(plugin.app, plugin);
  const input: WorkflowInput = { variables: new Map() };
  const result = await executor.execute(
    workflow,
    input,
    undefined,
    { workflowPath: file.path, workflowName: file.basename, recordHistory: false, abortSignal },
    headlessCallbacks(),
  );

  const text = extractString(result.context.variables, outputVariable);
  if (text == null) {
    throw new Error(
      "Workflow output is not a string. Store the Markdown/HTML output in `result` (or set Output variable).",
    );
  }
  return text;
}

// --- Sidecar cache (normal synced file under Dashboards/Data) ---

export const WORKFLOW_CACHE_FOLDER = `${DASHBOARD_FOLDER}/Data`;

export function workflowCachePath(dashboardPath: string): string {
  return `${WORKFLOW_CACHE_FOLDER}/${encodeURIComponent(dashboardPath)}.json`;
}

async function loadCacheFile(app: App, dashboardPath: string): Promise<Record<string, WorkflowCacheRecord>> {
  const path = workflowCachePath(dashboardPath);
  try {
    if (!(await app.vault.adapter.exists(path))) return {};
    return JSON.parse(await app.vault.adapter.read(path)) as Record<string, WorkflowCacheRecord>;
  } catch {
    return {};
  }
}

export async function loadWidgetCache(
  app: App,
  dashboardPath: string,
  widgetId: string,
): Promise<WorkflowCacheRecord | null> {
  if (!dashboardPath || !widgetId) return null;
  const caches = await loadCacheFile(app, dashboardPath);
  return caches[widgetId] ?? null;
}

// Serialize read-modify-write per sidecar file. Multiple workflow widgets can
// auto-update concurrently when a dashboard opens; without this, two saves that
// both read `{}` would clobber each other (last write wins).
const saveQueues = new Map<string, Promise<void>>();

// Cache-change notifications so a widget can reload its rendered output after its
// sidecar entry is rewritten elsewhere (e.g. the config editor's test-run or AI
// generation, which runs the workflow without the widget knowing).
type CacheListener = () => void;
const cacheListeners = new Map<string, Set<CacheListener>>();

function cacheListenerKey(dashboardPath: string, widgetId: string): string {
  return `${dashboardPath}\0${widgetId}`;
}

/**
 * Subscribe to cache writes for a specific widget. Returns an unsubscribe fn.
 */
export function onWidgetCacheChange(
  dashboardPath: string,
  widgetId: string,
  listener: CacheListener,
): () => void {
  const key = cacheListenerKey(dashboardPath, widgetId);
  let set = cacheListeners.get(key);
  if (!set) {
    set = new Set();
    cacheListeners.set(key, set);
  }
  set.add(listener);
  return () => {
    const current = cacheListeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) cacheListeners.delete(key);
  };
}

export async function saveWidgetCache(
  app: App,
  dashboardPath: string,
  widgetId: string,
  record: WorkflowCacheRecord,
): Promise<void> {
  if (!dashboardPath || !widgetId) return;
  const path = workflowCachePath(dashboardPath);
  const prev = saveQueues.get(path) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined) // a prior failure must not break the chain
    .then(async () => {
      const caches = await loadCacheFile(app, dashboardPath);
      caches[widgetId] = record;
      await ensureVaultFolder(app.vault, WORKFLOW_CACHE_FOLDER);
      await app.vault.adapter.write(path, JSON.stringify(caches, null, 2));
    });
  saveQueues.set(path, next);
  try {
    await next;
  } finally {
    if (saveQueues.get(path) === next) saveQueues.delete(path);
  }
  cacheListeners.get(cacheListenerKey(dashboardPath, widgetId))?.forEach((l) => l());
}
