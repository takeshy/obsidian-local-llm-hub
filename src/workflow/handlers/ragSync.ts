import type { App } from "obsidian";
import type { LocalLlmHubPlugin } from "../../plugin";
import { getRagStore } from "../../core/ragStore";
import type { ExecutionContext, WorkflowNode } from "../types";
import { replaceVariables } from "./utils";

export async function handleRagSyncNode(
  node: WorkflowNode,
  context: ExecutionContext,
  app: App,
  plugin: LocalLlmHubPlugin,
  abortSignal?: AbortSignal,
): Promise<{ ragSetting: string }> {
  abortSignal?.throwIfAborted();
  // Variable values often carry stray whitespace (LLM or dialog output); blank means "use the selected setting".
  const settingName = replaceVariables(node.properties["ragSetting"] || "", context).trim()
    || plugin.getSelectedRagSettingName();
  if (!settingName) {
    throw new Error("No RAG setting selected. Please select or create a RAG setting first.");
  }
  const ragSetting = plugin.getRagSetting(settingName);
  if (!ragSetting) {
    throw new Error(`RAG setting "${settingName}" not found.`);
  }
  if (ragSetting.externalIndexPath || ragSetting.sourceRagSettings.length > 0) {
    throw new Error(`RAG setting "${settingName}" is not a writable local index.`);
  }

  const store = getRagStore();
  const path = replaceVariables(node.properties["path"] || "", context);
  const oldPath = replaceVariables(node.properties["oldPath"] || "", context);
  let result;
  if (path) {
    result = await store.syncFile(app, settingName, ragSetting, plugin.settings.llmConfig, path, oldPath || undefined);
  } else {
    const failedFiles = new Set<string>();
    let syncResult;
    // Each pass processes at most 50 changed files; finish all deferred batches.
    do {
      abortSignal?.throwIfAborted();
      syncResult = await store.sync(app, settingName, ragSetting, plugin.settings.llmConfig, abortSignal);
      syncResult.failedFiles?.forEach(file => failedFiles.add(file));
    } while (syncResult.deferredFiles);
    result = { ...syncResult, failedFiles: [...failedFiles], syncedAt: Date.now() };
  }

  const saveTo = node.properties["saveTo"];
  if (saveTo) {
    context.variables.set(saveTo, JSON.stringify(result));
  }
  // The executor records this in logs and history instead of the unresolved property.
  return { ragSetting: settingName };
}
