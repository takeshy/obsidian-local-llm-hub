import { App, TFile, WorkspaceLeaf } from "obsidian";
import type { LocalLlmHubPlugin } from "../../plugin";
import { getRagStore } from "../../core/ragStore";
import { WorkflowNode, ExecutionContext, PromptCallbacks } from "../types";
import { replaceVariables } from "./utils";

// Handle workflow node - execute a sub-workflow
export async function handleWorkflowNode(
  node: WorkflowNode,
  context: ExecutionContext,
  _app: App,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const path = replaceVariables(node.properties["path"] || "", context);
  const name = node.properties["name"]
    ? replaceVariables(node.properties["name"], context)
    : undefined;
  const inputStr = node.properties["input"] || "";
  const outputStr = node.properties["output"] || "";

  if (!path) {
    throw new Error("Workflow node missing 'path' property");
  }

  if (!promptCallbacks?.executeSubWorkflow) {
    throw new Error("Sub-workflow execution not available");
  }

  // Parse input variable mapping
  const inputVariables = new Map<string, string | number>();
  if (inputStr) {
    const replacedInput = replaceVariables(inputStr, context);
    try {
      const inputMapping = JSON.parse(replacedInput);
      if (typeof inputMapping === "object" && inputMapping !== null) {
        for (const [key, value] of Object.entries(inputMapping)) {
          if (typeof value === "string" || typeof value === "number") {
            inputVariables.set(key, value);
          } else {
            inputVariables.set(key, JSON.stringify(value));
          }
        }
      }
    } catch {
      const pairs = replacedInput.split(",");
      for (const pair of pairs) {
        const eqIndex = pair.indexOf("=");
        if (eqIndex !== -1) {
          const key = pair.substring(0, eqIndex).trim();
          const value = pair.substring(eqIndex + 1).trim();
          if (key) {
            const contextValue = context.variables.get(value);
            inputVariables.set(key, contextValue !== undefined ? contextValue : value);
          }
        }
      }
    }
  }

  const resultVariables = await promptCallbacks.executeSubWorkflow(
    path,
    name,
    inputVariables
  );

  // Copy output variables back to parent context
  if (outputStr) {
    const replacedOutput = replaceVariables(outputStr, context);
    try {
      const outputMapping = JSON.parse(replacedOutput);
      if (typeof outputMapping === "object" && outputMapping !== null) {
        for (const [parentVar, subVar] of Object.entries(outputMapping)) {
          if (typeof subVar === "string") {
            const value = resultVariables.get(subVar);
            if (value !== undefined) {
              context.variables.set(parentVar, value);
            }
          }
        }
      }
    } catch {
      const pairs = replacedOutput.split(",");
      for (const pair of pairs) {
        const eqIndex = pair.indexOf("=");
        if (eqIndex !== -1) {
          const parentVar = pair.substring(0, eqIndex).trim();
          const subVar = pair.substring(eqIndex + 1).trim();
          if (parentVar && subVar) {
            const value = resultVariables.get(subVar);
            if (value !== undefined) {
              context.variables.set(parentVar, value);
            }
          }
        }
      }
    }
  } else {
    const prefix = node.properties["prefix"] || "";
    for (const [key, value] of resultVariables) {
      context.variables.set(prefix + key, value);
    }
  }
}

// Handle rag-sync node - trigger a full RAG sync
export async function handleRagSyncNode(
  node: WorkflowNode,
  context: ExecutionContext,
  app: App,
  plugin: LocalLlmHubPlugin
): Promise<void> {
  const saveTo = node.properties["saveTo"];

  if (!plugin.settings.ragConfig.enabled) {
    throw new Error("RAG is not enabled. Please enable RAG in settings first.");
  }

  // Trigger a full sync of the local RAG store
  const store = getRagStore();
  const result = await store.sync(
    app,
    plugin.settings.ragConfig,
    plugin.settings.llmConfig,
    plugin.settings.workspaceFolder,
  );

  if (saveTo) {
    context.variables.set(saveTo, JSON.stringify({
      syncedAt: Date.now(),
      totalChunks: result.totalChunks,
      indexedFiles: result.indexedFiles,
    }));
  }
}

// Handle obsidian-command node
export async function handleObsidianCommandNode(
  node: WorkflowNode,
  context: ExecutionContext,
  app: App
): Promise<void> {
  const commandId = replaceVariables(node.properties["command"] || "", context);
  const path = replaceVariables(node.properties["path"] || "", context);

  if (!commandId) {
    throw new Error("obsidian-command node missing 'command' property");
  }

  const command = (app as unknown as { commands: { commands: Record<string, unknown> } }).commands.commands[commandId];
  if (!command) {
    throw new Error(`Command not found: ${commandId}`);
  }

  if (path) {
    const filePath = path.endsWith(".md") ? path : `${path}.md`;
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      throw new Error(`File not found: ${filePath}`);
    }

    let existingLeaf: WorkspaceLeaf | null = null;
    app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view?.getViewType() === "markdown") {
        const viewFile = (leaf.view as unknown as { file?: TFile }).file;
        if (viewFile?.path === file.path) {
          existingLeaf = leaf;
        }
      }
    });

    if (existingLeaf) {
      app.workspace.setActiveLeaf(existingLeaf, { focus: true });
    } else {
      const newLeaf = app.workspace.getLeaf("tab");
      await newLeaf.openFile(file);
      app.workspace.setActiveLeaf(newLeaf, { focus: true });
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  await (app as unknown as { commands: { executeCommandById: (id: string) => Promise<void> } }).commands.executeCommandById(commandId);

  const saveTo = node.properties["saveTo"];
  if (saveTo) {
    context.variables.set(saveTo, JSON.stringify({
      commandId,
      path: path || undefined,
      executed: true,
      timestamp: Date.now(),
    }));
  }
}

// Handle JSON parse node
export function handleJsonNode(
  node: WorkflowNode,
  context: ExecutionContext
): void {
  const sourceVar = node.properties["source"];
  const saveTo = node.properties["saveTo"];

  if (!sourceVar) {
    throw new Error("JSON node missing 'source' property");
  }
  if (!saveTo) {
    throw new Error("JSON node missing 'saveTo' property");
  }

  const sourceValue = context.variables.get(sourceVar);
  if (sourceValue === undefined) {
    throw new Error(`Variable '${sourceVar}' not found`);
  }

  let jsonString = String(sourceValue);

  const codeBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonString = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonString);
    context.variables.set(saveTo, JSON.stringify(parsed));
  } catch (e) {
    throw new Error(`Failed to parse JSON from '${sourceVar}': ${e instanceof Error ? e.message : String(e)}`);
  }
}
