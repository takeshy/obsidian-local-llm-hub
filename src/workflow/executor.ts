import { App, TFile } from "obsidian";
import type { LocalLlmHubPlugin } from "../plugin";
import type { StreamChunkUsage } from "../types";
import {
  Workflow,
  WorkflowNode,
  ExecutionContext,
  ExecutionLog,
  ExecutionRecord,
  WorkflowInput,
  PromptCallbacks,
} from "./types";
import { getNextNodes } from "./parser";
import {
  handleVariableNode,
  handleSetNode,
  handleIfNode,
  handleWhileNode,
  handleCommandNode,
  handleHttpNode,
  handleJsonNode,
  handleNoteNode,
  handleNoteReadNode,
  handleNoteSearchNode,
  handleNoteListNode,
  handleFolderListNode,
  handleOpenNode,
  handleDialogNode,
  handlePromptFileNode,
  handlePromptSelectionNode,
  handleFileExplorerNode,
  handleFileSaveNode,
  handleWorkflowNode,
  handleRagSyncNode,
  handleObsidianCommandNode,
  handleSleepNode,
  handleScriptNode,
  replaceVariables,
  RegenerateRequestError,
} from "./nodeHandlers";
import { parseWorkflowFromMarkdown } from "./parser";
import { ExecutionHistoryManager, EncryptionConfig } from "./history";
import { isEncryptedFile } from "../core/crypto";
import { formatError } from "../utils/error";

const MAX_ITERATIONS = 1000; // Prevent infinite loops

export interface ExecuteOptions {
  workflowPath?: string;
  workflowName?: string;
  recordHistory?: boolean;
  abortSignal?: AbortSignal;
  startNodeId?: string;
  initialVariables?: Map<string, string | number>;
}

export interface ExecuteResult {
  context: ExecutionContext;
  historyRecord?: ExecutionRecord;
}

export class WorkflowExecutor {
  private app: App;
  private plugin: LocalLlmHubPlugin;
  private historyManager: ExecutionHistoryManager;

  constructor(app: App, plugin: LocalLlmHubPlugin) {
    this.app = app;
    this.plugin = plugin;

    const encryptionConfig: EncryptionConfig | undefined = plugin.settings.encryption?.publicKey
      ? {
          enabled: plugin.settings.encryption.enabled,
          encryptWorkflowHistory: plugin.settings.encryption.encryptWorkflowHistory,
          publicKey: plugin.settings.encryption.publicKey,
          encryptedPrivateKey: plugin.settings.encryption.encryptedPrivateKey,
          salt: plugin.settings.encryption.salt,
        }
      : undefined;

    this.historyManager = new ExecutionHistoryManager(
      app,
      encryptionConfig
    );
  }

  async execute(
    workflow: Workflow,
    input: WorkflowInput,
    onLog?: (log: ExecutionLog) => void,
    options?: ExecuteOptions,
    promptCallbacks?: PromptCallbacks
  ): Promise<ExecuteResult> {
    const context: ExecutionContext = {
      variables: new Map(input.variables),
      logs: [],
    };

    if (options?.initialVariables) {
      for (const [key, value] of options.initialVariables) {
        context.variables.set(key, value);
      }
    }

    const shouldRecord = options?.recordHistory && options?.workflowPath;
    let historyRecord: ExecutionRecord | undefined;
    if (shouldRecord && options.workflowPath) {
      historyRecord = this.historyManager.createRecord(
        options.workflowPath,
        options.workflowName
      );
    }

    if (!workflow.startNode) {
      throw new Error("No workflow nodes found");
    }

    const log = (
      nodeId: string,
      nodeType: WorkflowNode["type"],
      message: string,
      status: ExecutionLog["status"] = "info",
      input?: Record<string, unknown>,
      output?: unknown,
      usage?: StreamChunkUsage,
      elapsedMs?: number
    ) => {
      const logEntry: ExecutionLog = {
        nodeId,
        nodeType,
        message,
        timestamp: new Date(),
        status,
        input,
        output,
        usage,
        elapsedMs,
      };
      context.logs.push(logEntry);
      onLog?.(logEntry);
    };

    // Truncate large data for history logging
    const MAX_STRING_LENGTH = 1000;
    const truncateLargeData = (data: unknown): unknown => {
      if (data === null || data === undefined) return data;

      if (typeof data === "string") {
        if (data.length > MAX_STRING_LENGTH) {
          if (/^[A-Za-z0-9+/=]+$/.test(data.substring(0, 100))) {
            return `[Binary data: ${data.length} chars]`;
          }
          return `${data.substring(0, 400)}...[truncated ${data.length - 800} chars]...${data.substring(data.length - 400)}`;
        }
        return data;
      }

      if (Array.isArray(data)) {
        return data.map((item) => truncateLargeData(item));
      }

      if (typeof data === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
          result[key] = truncateLargeData(value);
        }
        return result;
      }

      return data;
    };

    let currentVarsSnapshot: Record<string, string | number> | undefined;
    let skipSnapshots = false;
    const historyEncrypted = !!(
      this.plugin.settings.encryption?.encryptWorkflowHistory &&
      this.plugin.settings.encryption?.publicKey &&
      this.plugin.settings.encryption?.encryptedPrivateKey &&
      this.plugin.settings.encryption?.salt
    );

    const addHistoryStep = (
      nodeId: string,
      nodeType: WorkflowNode["type"],
      input?: Record<string, unknown>,
      output?: unknown,
      status: "success" | "error" | "skipped" = "success",
      error?: string,
      usage?: StreamChunkUsage,
      elapsedMs?: number
    ) => {
      if (historyRecord) {
        this.historyManager.addStep(
          historyRecord,
          nodeId,
          nodeType,
          truncateLargeData(input) as Record<string, unknown> | undefined,
          truncateLargeData(output),
          status,
          error,
          currentVarsSnapshot,
          usage,
          elapsedMs
        );
      }
    };

    const startNode = options?.startNodeId || workflow.startNode;
    const stack: { nodeId: string; iterationCount: number }[] = [
      { nodeId: startNode, iterationCount: 0 },
    ];

    const whileLoopStates = new Map<string, { iterationCount: number }>();

    let totalIterations = 0;
    let currentNodeInput: Record<string, unknown> | undefined;

    while (stack.length > 0 && totalIterations < MAX_ITERATIONS) {
      if (options?.abortSignal?.aborted) {
        const abortMsg = "Workflow execution was stopped";
        if (historyRecord) {
          this.historyManager.completeRecord(historyRecord, "error");
          await this.historyManager.saveRecord(historyRecord);
        }
        throw new Error(abortMsg);
      }

      totalIterations++;
      const current = stack.pop()!;
      const node = workflow.nodes.get(current.nodeId);

      if (!node) {
        continue;
      }

      log(node.id, node.type, `Executing node: ${node.type}`);

      if (!skipSnapshots) {
        currentVarsSnapshot = {};
        for (const [key, value] of context.variables) {
          currentVarsSnapshot[key] = value;
        }
      } else {
        currentVarsSnapshot = undefined;
      }

      currentNodeInput = undefined;

      try {
        switch (node.type) {
          case "variable": {
            handleVariableNode(node, context);
            const varName = node.properties["name"];
            const varValue = context.variables.get(varName);
            const varInput = { name: varName, value: replaceVariables(node.properties["value"] || "", context) };
            log(node.id, node.type, `Set variable ${varName} = ${varValue}`, "success", varInput, varValue);
            addHistoryStep(node.id, node.type, varInput, varValue, "success");
            const varNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of varNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "set": {
            await handleSetNode(node, context);
            const setVarName = node.properties["name"];
            const setVarValue = context.variables.get(setVarName);
            const setInput = { name: setVarName, expression: replaceVariables(node.properties["value"] || "", context) };
            log(node.id, node.type, `Updated variable ${setVarName} = ${setVarValue}`, "success", setInput, setVarValue);
            addHistoryStep(node.id, node.type, setInput, setVarValue, "success");
            const setNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of setNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "if": {
            const ifResult = handleIfNode(node, context);
            const ifInput = { condition: replaceVariables(node.properties["condition"] || "", context) };
            log(node.id, node.type, `Condition evaluated to: ${ifResult}`, "success", ifInput, ifResult);
            addHistoryStep(node.id, node.type, ifInput, ifResult, "success");
            const ifNextNodes = getNextNodes(workflow, node.id, ifResult);
            for (const nextId of ifNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "while": {
            const whileResult = handleWhileNode(node, context);
            const whileState = whileLoopStates.get(node.id) || { iterationCount: 0 };

            if (whileResult) {
              whileState.iterationCount++;
              if (whileState.iterationCount > MAX_ITERATIONS) {
                throw new Error(`While loop exceeded maximum iterations (${MAX_ITERATIONS})`);
              }
              whileLoopStates.set(node.id, whileState);

              const whileTrueInput = {
                condition: replaceVariables(node.properties["condition"] || "", context),
                iteration: whileState.iterationCount,
              };
              log(node.id, node.type, `Loop iteration ${whileState.iterationCount}, condition: true`, "info", whileTrueInput, whileResult);
              addHistoryStep(node.id, node.type, whileTrueInput, whileResult, "success");

              const trueNodes = getNextNodes(workflow, node.id, true);
              for (const nextId of trueNodes.reverse()) {
                stack.push({ nodeId: nextId, iterationCount: 0 });
              }
            } else {
              const whileFalseInput = { condition: replaceVariables(node.properties["condition"] || "", context) };
              log(node.id, node.type, `Loop condition false, exiting`, "success", whileFalseInput, whileResult);
              addHistoryStep(node.id, node.type, whileFalseInput, whileResult, "success");
              whileLoopStates.delete(node.id);

              const falseNodes = getNextNodes(workflow, node.id, false);
              for (const nextId of falseNodes.reverse()) {
                stack.push({ nodeId: nextId, iterationCount: 0 });
              }
            }
            break;
          }

          case "command": {
            const promptTemplate = node.properties["prompt"] || "";
            const promptPreview = promptTemplate.length > 50
              ? promptTemplate.substring(0, 50) + "..."
              : promptTemplate;
            log(node.id, node.type, `Executing LLM: ${promptPreview}`, "info");

            const cmdResult = await handleCommandNode(node, context, this.app, this.plugin, promptCallbacks);

            const cmdInput: Record<string, unknown> = {
              prompt: replaceVariables(promptTemplate, context),
            };

            const saveTo = node.properties["saveTo"];
            const cmdOutput = saveTo ? context.variables.get(saveTo) : undefined;
            if (saveTo) {
              const response = context.variables.get(saveTo);
              const preview =
                typeof response === "string"
                  ? response.substring(0, 50) + "..."
                  : response;
              log(node.id, node.type, `LLM completed, saved to ${saveTo}: ${preview}`, "success", cmdInput, cmdOutput, cmdResult.usage, cmdResult.elapsedMs);
            } else {
              log(node.id, node.type, `LLM completed`, "success", cmdInput, cmdOutput, cmdResult.usage, cmdResult.elapsedMs);
            }
            addHistoryStep(node.id, node.type, cmdInput, cmdOutput, "success", undefined, cmdResult.usage, cmdResult.elapsedMs);

            const cmdNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of cmdNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "http": {
            const httpUrlTemplate = node.properties["url"] || "";
            const httpUrl = replaceVariables(httpUrlTemplate, context);
            const httpMethod = node.properties["method"] || "GET";
            const httpContentType = node.properties["contentType"] || "json";
            log(node.id, node.type, `HTTP ${httpMethod} ${httpUrl}`, "info");

            const httpInput: Record<string, unknown> = {
              url: httpUrl,
              method: httpMethod,
              contentType: httpContentType,
            };
            if (node.properties["headers"])
              httpInput.headers = replaceVariables(node.properties["headers"], context);
            if (node.properties["body"])
              httpInput.body = replaceVariables(node.properties["body"], context);

            currentNodeInput = httpInput;

            await handleHttpNode(node, context);

            const httpSaveTo = node.properties["saveTo"];
            const httpOutput = httpSaveTo ? context.variables.get(httpSaveTo) : undefined;
            if (httpSaveTo) {
              const httpResponse = context.variables.get(httpSaveTo);
              const httpPreview =
                typeof httpResponse === "string"
                  ? httpResponse.substring(0, 50) + "..."
                  : httpResponse;
              log(node.id, node.type, `HTTP completed, saved to ${httpSaveTo}: ${httpPreview}`, "success", httpInput, httpOutput);
            } else {
              log(node.id, node.type, `HTTP completed`, "success", httpInput, httpOutput);
            }
            addHistoryStep(node.id, node.type, httpInput, httpOutput, "success");

            const httpNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of httpNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "json": {
            const jsonSource = node.properties["source"] || "";
            const jsonSaveTo = node.properties["saveTo"] || "";
            log(node.id, node.type, `Parsing JSON: ${jsonSource} -> ${jsonSaveTo}`, "info");

            const jsonInputData = context.variables.get(jsonSource);
            handleJsonNode(node, context);
            const jsonOutput = context.variables.get(jsonSaveTo);
            const jsonInput = { source: jsonSource, input: jsonInputData };

            log(node.id, node.type, `JSON parsed successfully`, "success", jsonInput, jsonOutput);
            addHistoryStep(node.id, node.type, jsonInput, jsonOutput, "success");

            const jsonNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of jsonNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "note": {
            const notePath = node.properties["path"] || "";
            const noteMode = node.properties["mode"] || "overwrite";
            log(node.id, node.type, `Writing note: ${notePath} (${noteMode})`, "info");

            const noteInput: Record<string, unknown> = {
              path: replaceVariables(notePath, context),
              mode: noteMode,
              content: replaceVariables(node.properties["content"] || "", context),
            };

            await handleNoteNode(node, context, this.app, promptCallbacks);

            const noteResolvedPath = replaceVariables(notePath, context);
            log(node.id, node.type, `Note written: ${noteResolvedPath}`, "success", noteInput, noteResolvedPath);
            addHistoryStep(node.id, node.type, noteInput, noteResolvedPath, "success");

            const noteNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of noteNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "note-read": {
            const noteReadPath = node.properties["path"] || "";
            const noteReadSaveTo = node.properties["saveTo"] || "";
            log(node.id, node.type, `Reading note: ${noteReadPath}`, "info");

            await handleNoteReadNode(node, context, this.app, promptCallbacks);

            if (!skipSnapshots && !historyEncrypted) {
              const noteReadResolvedPath = replaceVariables(noteReadPath, context);
              const noteReadCheckPath = noteReadResolvedPath.endsWith(".md") ? noteReadResolvedPath : `${noteReadResolvedPath}.md`;
              const noteReadCheckFile = this.app.vault.getAbstractFileByPath(noteReadCheckPath);
              if (noteReadCheckFile instanceof TFile) {
                const rawContent = await this.app.vault.read(noteReadCheckFile);
                if (isEncryptedFile(rawContent)) {
                  skipSnapshots = true;
                }
              }
            }

            const noteReadContent = context.variables.get(noteReadSaveTo);
            const noteReadIsEncrypted = skipSnapshots && !historyEncrypted;
            const noteReadOutput = noteReadIsEncrypted ? "(encrypted)" : noteReadContent;
            const noteReadPreview = noteReadIsEncrypted
              ? "(encrypted)"
              : typeof noteReadContent === "string"
                ? noteReadContent.substring(0, 50) + (noteReadContent.length > 50 ? "..." : "")
                : noteReadContent;
            const noteReadInput = { path: replaceVariables(noteReadPath, context) };
            log(node.id, node.type, `Note read, saved to ${noteReadSaveTo}: ${noteReadPreview}`, "success", noteReadInput, noteReadOutput);
            addHistoryStep(node.id, node.type, noteReadInput, noteReadOutput, "success");

            const noteReadNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of noteReadNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "note-search": {
            const noteSearchQuery = node.properties["query"] || "";
            const noteSearchSaveTo = node.properties["saveTo"] || "";
            const noteSearchContent = node.properties["searchContent"] === "true";
            log(node.id, node.type, `Searching notes: ${noteSearchQuery} (content: ${noteSearchContent})`, "info");

            await handleNoteSearchNode(node, context, this.app);

            const noteSearchResults = context.variables.get(noteSearchSaveTo);
            const noteSearchInput = { query: replaceVariables(noteSearchQuery, context), searchContent: noteSearchContent };
            log(node.id, node.type, `Search complete, saved to ${noteSearchSaveTo}`, "success", noteSearchInput, noteSearchResults);
            addHistoryStep(node.id, node.type, noteSearchInput, noteSearchResults, "success");

            const noteSearchNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of noteSearchNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "note-list": {
            const noteListFolder = node.properties["folder"] || "";
            const noteListSaveTo = node.properties["saveTo"] || "";
            const noteListRecursive = node.properties["recursive"] === "true";
            log(node.id, node.type, `Listing notes in: ${noteListFolder || "(root)"} (recursive: ${noteListRecursive})`, "info");

            handleNoteListNode(node, context, this.app);

            const noteListResults = context.variables.get(noteListSaveTo);
            const noteListInput = { folder: noteListFolder, recursive: noteListRecursive };
            log(node.id, node.type, `List complete, saved to ${noteListSaveTo}`, "success", noteListInput, noteListResults);
            addHistoryStep(node.id, node.type, noteListInput, noteListResults, "success");

            const noteListNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of noteListNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "folder-list": {
            const folderListParent = node.properties["folder"] || "";
            const folderListSaveTo = node.properties["saveTo"] || "";
            log(node.id, node.type, `Listing folders in: ${folderListParent || "(root)"}`, "info");

            handleFolderListNode(node, context, this.app);

            const folderListResults = context.variables.get(folderListSaveTo);
            const folderListInput = { folder: folderListParent };
            log(node.id, node.type, `Folder list complete, saved to ${folderListSaveTo}`, "success", folderListInput, folderListResults);
            addHistoryStep(node.id, node.type, folderListInput, folderListResults, "success");

            const folderListNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of folderListNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "open": {
            const openPath = replaceVariables(node.properties["path"] || "", context);
            log(node.id, node.type, `Opening file: ${openPath}`, "info");

            await handleOpenNode(node, context, this.app, promptCallbacks);

            const openInput = { path: openPath };
            log(node.id, node.type, `File opened: ${openPath}`, "success", openInput, openPath);
            addHistoryStep(node.id, node.type, openInput, openPath, "success");

            const openNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of openNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "dialog": {
            const dialogTitle = node.properties["title"] || "Dialog";
            const dialogSaveTo = node.properties["saveTo"] || "";
            log(node.id, node.type, `Showing dialog: ${dialogTitle}`, "info");

            await handleDialogNode(node, context, this.app, promptCallbacks);

            const dialogResult = dialogSaveTo ? context.variables.get(dialogSaveTo) : undefined;
            const dialogInput = { title: dialogTitle };
            log(node.id, node.type, `Dialog completed`, "success", dialogInput, dialogResult);
            addHistoryStep(node.id, node.type, dialogInput, dialogResult, "success");

            const dialogNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of dialogNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "prompt-file": {
            const promptFileTitle = node.properties["title"] || "Select a file";
            const promptFileSaveTo = node.properties["saveTo"] || "";
            log(node.id, node.type, `Prompting for file: ${promptFileTitle}`, "info");

            await handlePromptFileNode(node, context, this.app, promptCallbacks);

            const selectedFile = context.variables.get(promptFileSaveTo);
            const promptFileInput = { title: promptFileTitle };
            log(node.id, node.type, `File selected: ${selectedFile}`, "success", promptFileInput, selectedFile);
            addHistoryStep(node.id, node.type, promptFileInput, selectedFile, "success");

            const promptFileNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of promptFileNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "prompt-selection": {
            const promptSelTitle = node.properties["title"] || "Select text";
            const promptSelSaveTo = node.properties["saveTo"] || "";
            log(node.id, node.type, `Prompting for selection: ${promptSelTitle}`, "info");

            await handlePromptSelectionNode(node, context, this.app, promptCallbacks);

            const selectedText = context.variables.get(promptSelSaveTo);
            const preview =
              typeof selectedText === "string"
                ? selectedText.substring(0, 50) + (selectedText.length > 50 ? "..." : "")
                : selectedText;
            const promptSelInput = { title: promptSelTitle };
            log(node.id, node.type, `Selection saved to ${promptSelSaveTo}: ${preview}`, "success", promptSelInput, selectedText);
            addHistoryStep(node.id, node.type, promptSelInput, selectedText, "success");

            const promptSelNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of promptSelNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "file-explorer": {
            const fileExpTitle = node.properties["title"] || "Select a file";
            const fileExpMode = node.properties["mode"] || "select";
            const fileExpSaveTo = node.properties["saveTo"] || "";
            const fileExpSavePathTo = node.properties["savePathTo"] || "";
            log(node.id, node.type, `File explorer (${fileExpMode}): ${fileExpTitle}`, "info");

            await handleFileExplorerNode(node, context, this.app, promptCallbacks);

            const fileExpResult = fileExpSaveTo
              ? context.variables.get(fileExpSaveTo)
              : context.variables.get(fileExpSavePathTo);
            const fileExpInput = { title: fileExpTitle, mode: fileExpMode };
            log(node.id, node.type, `File explorer completed`, "success", fileExpInput, fileExpResult);
            addHistoryStep(node.id, node.type, fileExpInput, fileExpResult, "success");

            const fileExpNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of fileExpNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "file-save": {
            const fileSaveSource = node.properties["source"] || "";
            const fileSavePath = replaceVariables(node.properties["path"] || "", context);
            log(node.id, node.type, `Saving file from '${fileSaveSource}' to '${fileSavePath}'`, "info");

            await handleFileSaveNode(node, context, this.app);

            const fileSaveInput = { source: fileSaveSource, path: fileSavePath };
            log(node.id, node.type, `File saved to ${fileSavePath}`, "success", fileSaveInput, fileSavePath);
            addHistoryStep(node.id, node.type, fileSaveInput, fileSavePath, "success");

            const fileSaveNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of fileSaveNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "workflow": {
            const subWorkflowPath = replaceVariables(node.properties["path"] || "", context);
            const subWorkflowName = node.properties["name"]
              ? replaceVariables(node.properties["name"], context)
              : undefined;
            log(node.id, node.type, `Executing sub-workflow: ${subWorkflowPath}${subWorkflowName ? ` (${subWorkflowName})` : ""}`, "info");

            const executeSubWorkflow = async (
              workflowPath: string,
              workflowName: string | undefined,
              inputVariables: Map<string, string | number>
            ): Promise<Map<string, string | number>> => {
              const file = this.app.vault.getAbstractFileByPath(workflowPath);
              if (!file) {
                const mdPath = workflowPath.endsWith(".md") ? workflowPath : `${workflowPath}.md`;
                const mdFile = this.app.vault.getAbstractFileByPath(mdPath);
                if (!mdFile) {
                  throw new Error(`Workflow file not found: ${workflowPath}`);
                }
                workflowPath = mdPath;
              }

              const actualFile = this.app.vault.getAbstractFileByPath(workflowPath);
              if (!(actualFile instanceof TFile)) {
                throw new Error(`Invalid workflow file: ${workflowPath}`);
              }

              const content = await this.app.vault.read(actualFile);
              const subWorkflow = parseWorkflowFromMarkdown(content, workflowName);

              const subInput: WorkflowInput = { variables: inputVariables };
              const subResult = await this.execute(
                subWorkflow,
                subInput,
                (subLog) => {
                  const logNodeType = subLog.nodeType === "system" ? node.type : subLog.nodeType;
                  log(
                    `${node.id}/${subLog.nodeId}`,
                    logNodeType,
                    `[sub] ${subLog.message}`,
                    subLog.status
                  );
                },
                undefined,
                promptCallbacks
              );

              return subResult.context.variables;
            };

            const extendedCallbacks: PromptCallbacks | undefined = promptCallbacks
              ? { ...promptCallbacks, executeSubWorkflow }
              : {
                  promptForFile: () => Promise.resolve(null),
                  promptForSelection: () => Promise.resolve(null),
                  promptForValue: () => Promise.resolve(null),
                  promptForConfirmation: () => Promise.resolve({ action: "cancel" as const }),
                  executeSubWorkflow
                };

            await handleWorkflowNode(node, context, this.app, extendedCallbacks);

            const subWorkflowInput = { path: subWorkflowPath, name: subWorkflowName };
            log(node.id, node.type, `Sub-workflow completed: ${subWorkflowPath}`, "success", subWorkflowInput, "completed");
            addHistoryStep(node.id, node.type, subWorkflowInput, "completed", "success");

            const workflowNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of workflowNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "rag-sync": {
            const ragSyncPath = replaceVariables(node.properties["path"] || "", context);
            const ragSettingName = node.properties["ragSetting"] || "";
            log(node.id, node.type, `Syncing to RAG: ${ragSyncPath}${ragSettingName ? ` (${ragSettingName})` : ""}`, "info");

            await handleRagSyncNode(node, context, this.app, this.plugin);

            const ragSyncSaveTo = node.properties["saveTo"];
            const ragSyncResult = ragSyncSaveTo ? context.variables.get(ragSyncSaveTo) : undefined;
            const ragSyncInput = { path: ragSyncPath, ragSetting: ragSettingName };
            log(node.id, node.type, `RAG sync completed: ${ragSyncPath}`, "success", ragSyncInput, ragSyncResult);
            addHistoryStep(node.id, node.type, ragSyncInput, ragSyncResult, "success");

            const ragSyncNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of ragSyncNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "obsidian-command": {
            const obsidianCommandId = replaceVariables(node.properties["command"] || "", context);
            log(node.id, node.type, `Executing Obsidian command: ${obsidianCommandId}`, "info");

            const obsidianCmdInput: Record<string, unknown> = {
              command: obsidianCommandId,
            };

            await handleObsidianCommandNode(node, context, this.app);

            const obsidianCmdSaveTo = node.properties["saveTo"];
            const obsidianCmdResult = obsidianCmdSaveTo
              ? context.variables.get(obsidianCmdSaveTo)
              : undefined;
            log(node.id, node.type, `Obsidian command executed: ${obsidianCommandId}`, "success", obsidianCmdInput, obsidianCmdResult);
            addHistoryStep(node.id, node.type, obsidianCmdInput, obsidianCmdResult, "success");

            const obsidianCmdNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of obsidianCmdNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "sleep": {
            const sleepDuration = replaceVariables(node.properties["duration"] || "0", context);
            log(node.id, node.type, `Sleeping for ${sleepDuration}ms`, "info");

            const sleepInput: Record<string, unknown> = {
              duration: sleepDuration,
            };

            await handleSleepNode(node, context);

            log(node.id, node.type, `Sleep completed`, "success", sleepInput);
            addHistoryStep(node.id, node.type, sleepInput, undefined, "success");

            const sleepNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of sleepNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

          case "script": {
            const scriptCode = replaceVariables(node.properties["code"] || "", context);
            const scriptInput: Record<string, unknown> = {
              code: scriptCode,
              timeout: node.properties["timeout"] || "10000",
            };
            log(node.id, node.type, `Executing script`, "info", scriptInput);

            await handleScriptNode(node, context);

            const scriptSaveTo = node.properties["saveTo"];
            const scriptResult = scriptSaveTo
              ? context.variables.get(scriptSaveTo)
              : undefined;
            log(
              node.id,
              node.type,
              `Script executed successfully`,
              "success",
              scriptInput,
              scriptResult
            );
            addHistoryStep(
              node.id,
              node.type,
              scriptInput,
              scriptResult,
              "success"
            );

            // Push next nodes
            const scriptNextNodes = getNextNodes(workflow, node.id);
            for (const nextId of scriptNextNodes.reverse()) {
              stack.push({ nodeId: nextId, iterationCount: 0 });
            }
            break;
          }

        }
      } catch (error) {
        // Check if this is a regeneration request
        if (error instanceof RegenerateRequestError && context.regenerateInfo) {
          const regenerateInfo = context.regenerateInfo;
          log(
            node.id,
            node.type,
            `User requested regeneration with feedback: "${regenerateInfo.additionalRequest.substring(0, 50)}..."`,
            "info"
          );

          stack.push({ nodeId: node.id, iterationCount: 0 });
          stack.push({ nodeId: regenerateInfo.commandNodeId, iterationCount: 0 });
          continue;
        }

        const errorMessage = formatError(error);
        log(node.id, node.type, `Error: ${errorMessage}`, "error");
        addHistoryStep(node.id, node.type, currentNodeInput, undefined, "error", errorMessage);

        if (historyRecord) {
          historyRecord.errorNodeId = node.id;
          const snapshot: Record<string, string | number> = {};
          for (const [key, value] of context.variables) {
            snapshot[key] = value;
          }
          historyRecord.variablesSnapshot = snapshot;

          this.historyManager.completeRecord(historyRecord, "error");
          await this.historyManager.saveRecord(historyRecord);
        }

        throw error;
      }
    }

    if (totalIterations >= MAX_ITERATIONS) {
      const errorMsg = `Workflow exceeded maximum iterations (${MAX_ITERATIONS})`;

      if (historyRecord) {
        this.historyManager.completeRecord(historyRecord, "error");
        await this.historyManager.saveRecord(historyRecord);
      }

      throw new Error(errorMsg);
    }

    // Complete and save history
    if (historyRecord) {
      this.historyManager.completeRecord(historyRecord, "completed");
      await this.historyManager.saveRecord(historyRecord);
    }

    return { context, historyRecord };
  }
}
