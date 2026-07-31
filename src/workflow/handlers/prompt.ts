import { App, TFile } from "obsidian";
import { WorkflowNode, ExecutionContext, PromptCallbacks } from "../types";
import { replaceVariables } from "./utils";
import { getEventVariable } from "../eventVariables";
import {
  assertVaultToolFileAllowed,
  assertVaultToolPathAllowed,
} from "../../core/vaultToolScope";

// Helper function to create file info object from path
function createFileInfo(filePath: string): { path: string; basename: string; name: string; extension: string } {
  const parts = filePath.split("/");
  const basename = parts[parts.length - 1];
  const lastDotIndex = basename.lastIndexOf(".");
  const name = lastDotIndex > 0 ? basename.substring(0, lastDotIndex) : basename;
  const extension = lastDotIndex > 0 ? basename.substring(lastDotIndex + 1) : "";
  return { path: filePath, basename, name, extension };
}

function parsePathInfo(value: string): { path: string } | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === "object"
      && parsed !== null
      && typeof (parsed as { path?: unknown }).path === "string"
    ) {
      return { path: (parsed as { path: string }).path };
    }
  } catch {
    // Invalid JSON
  }
  return null;
}

// Handle prompt-file node
export async function handlePromptFileNode(
  node: WorkflowNode,
  context: ExecutionContext,
  app: App,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const defaultPath = replaceVariables(node.properties["default"] || "", context);
  const saveTo = node.properties["saveTo"];
  const saveFileTo = node.properties["saveFileTo"];
  const forcePrompt = node.properties["forcePrompt"] === "true";

  if (!saveTo) {
    throw new Error("prompt-file node missing 'saveTo' property");
  }

  let filePath: string | null = null;

  const hotkeyActiveFile = context.variables.get("__hotkeyActiveFile__");
  const eventFile = getEventVariable(context.variables, "_eventFile");

  if (forcePrompt) {
    if (!promptCallbacks?.promptForFile) {
      throw new Error("File prompt callback not available");
    }
    filePath = await promptCallbacks.promptForFile(defaultPath);
    if (filePath === null) {
      throw new Error("File selection cancelled by user");
    }
  } else if (hotkeyActiveFile) {
    const fileInfo = parsePathInfo(String(hotkeyActiveFile));
    if (fileInfo) {
      filePath = fileInfo.path;
    }
  } else if (typeof eventFile === "string") {
    const fileInfo = parsePathInfo(eventFile);
    if (fileInfo) {
      filePath = fileInfo.path;
    }
  }

  if (filePath === null) {
    if (!promptCallbacks?.promptForFile) {
      throw new Error("File prompt callback not available");
    }
    filePath = await promptCallbacks.promptForFile(defaultPath);
  }

  if (filePath === null) {
    throw new Error("File selection cancelled by user");
  }

  const notePath = filePath.endsWith(".md") ? filePath : `${filePath}.md`;
  assertVaultToolPathAllowed(notePath, context.vaultToolAllowedFolders);
  const file = app.vault.getAbstractFileByPath(notePath);
  if (!file || !(file instanceof TFile)) {
    throw new Error(`File not found: ${notePath}`);
  }
  assertVaultToolFileAllowed(file, context.vaultToolAllowedFolders);
  const content = await app.vault.read(file);

  context.variables.set(saveTo, content);

  if (saveFileTo) {
    const fileInfo = createFileInfo(filePath);
    context.variables.set(saveFileTo, JSON.stringify(fileInfo));
  }
}

// Handle prompt-selection node
export async function handlePromptSelectionNode(
  node: WorkflowNode,
  context: ExecutionContext,
  app: App,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const saveTo = node.properties["saveTo"];
  const saveSelectionTo = node.properties["saveSelectionTo"];

  if (!saveTo) {
    throw new Error("prompt-selection node missing 'saveTo' property");
  }

  const hotkeySelection = context.variables.get("__hotkeySelection__");
  const hotkeySelectionInfo = context.variables.get("__hotkeySelectionInfo__");

  if (hotkeySelection !== undefined && hotkeySelection !== "") {
    const selectionText = String(hotkeySelection);
    context.variables.set(saveTo, selectionText);
    if (saveSelectionTo && hotkeySelectionInfo) {
      context.variables.set(saveSelectionTo, String(hotkeySelectionInfo));
    }
    return;
  }

  const hotkeyContent = context.variables.get("__hotkeyContent__");
  const hotkeyActiveFile = context.variables.get("__hotkeyActiveFile__");

  if (hotkeyContent !== undefined && hotkeyContent !== "") {
    const fullContent = String(hotkeyContent);
    context.variables.set(saveTo, fullContent);

    if (saveSelectionTo && hotkeyActiveFile) {
      const fileInfo = parsePathInfo(String(hotkeyActiveFile));
      if (fileInfo) {
        const lines = fullContent.split("\n");
        context.variables.set(saveSelectionTo, JSON.stringify({
          filePath: fileInfo.path,
          startLine: 1,
          endLine: lines.length,
          start: 0,
          end: fullContent.length,
        }));
      }
    }
    return;
  }

  const eventFileContent = getEventVariable(context.variables, "_eventFileContent");
  const eventFilePath = getEventVariable(context.variables, "_eventFilePath");
  const eventFile = getEventVariable(context.variables, "_eventFile");

  if (eventFileContent !== undefined && eventFileContent !== "") {
    const fullContent = eventFileContent as string;
    context.variables.set(saveTo, fullContent);

    if (saveSelectionTo) {
      const filePath = eventFilePath ? (eventFilePath as string) : "";
      const lines = fullContent.split("\n");
      context.variables.set(saveSelectionTo, JSON.stringify({
        filePath: filePath,
        startLine: 1,
        endLine: lines.length,
        start: 0,
        end: fullContent.length,
      }));
    }
    return;
  }

  if (typeof eventFile === "string") {
    const fileInfo = parsePathInfo(eventFile);
    if (fileInfo) {
      try {
        assertVaultToolPathAllowed(fileInfo.path, context.vaultToolAllowedFolders);
        const file = app.vault.getAbstractFileByPath(fileInfo.path);
        if (file && file instanceof TFile) {
          assertVaultToolFileAllowed(file, context.vaultToolAllowedFolders);
          const content = await app.vault.read(file);
          context.variables.set(saveTo, content);

          if (saveSelectionTo) {
            const lines = content.split("\n");
            context.variables.set(saveSelectionTo, JSON.stringify({
              filePath: fileInfo.path,
              startLine: 1,
              endLine: lines.length,
              start: 0,
              end: content.length,
            }));
          }
          return;
        }
      } catch {
        // Invalid event file
      }
    }
  }

  if (!promptCallbacks?.promptForSelection) {
    throw new Error("Selection prompt callback not available");
  }

  const result = await promptCallbacks.promptForSelection();

  if (result === null) {
    throw new Error("Selection cancelled by user");
  }

  assertVaultToolPathAllowed(result.path, context.vaultToolAllowedFolders);
  const file = app.vault.getAbstractFileByPath(result.path);
  if (!file || !(file instanceof TFile)) {
    throw new Error(`File not found: ${result.path}`);
  }
  assertVaultToolFileAllowed(file, context.vaultToolAllowedFolders);
  const fileContent = await app.vault.read(file);

  const lines = fileContent.split("\n");
  let startOffset = 0;
  for (let i = 0; i < result.start.line; i++) {
    startOffset += lines[i].length + 1;
  }
  startOffset += result.start.ch;

  let endOffset = 0;
  for (let i = 0; i < result.end.line; i++) {
    endOffset += lines[i].length + 1;
  }
  endOffset += result.end.ch;

  const selectedText = fileContent.substring(startOffset, endOffset);

  context.variables.set(saveTo, selectedText);
  if (saveSelectionTo) {
    context.variables.set(saveSelectionTo, JSON.stringify({
      filePath: result.path,
      startLine: result.start.line,
      endLine: result.end.line,
      start: startOffset,
      end: endOffset,
    }));
  }
}

// Handle dialog node
export async function handleDialogNode(
  node: WorkflowNode,
  context: ExecutionContext,
  _app: App,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const title = replaceVariables(node.properties["title"] || "Dialog", context);
  const message = replaceVariables(node.properties["message"] || "", context);
  const optionsStr = replaceVariables(node.properties["options"] || "", context);
  const multiSelect = node.properties["multiSelect"] === "true";
  const markdown = node.properties["markdown"] === "true";
  const button1 = replaceVariables(node.properties["button1"] || "OK", context);
  const button2Prop = node.properties["button2"];
  const button2 = button2Prop ? replaceVariables(button2Prop, context) : undefined;
  const inputTitleProp = node.properties["inputTitle"];
  const inputTitle = inputTitleProp ? replaceVariables(inputTitleProp, context) : undefined;
  const multiline = node.properties["multiline"] === "true";
  const defaultsProp = node.properties["defaults"];
  const saveTo = node.properties["saveTo"];

  let defaults: { input?: string; selected?: string[] } | undefined;
  if (defaultsProp) {
    try {
      const parsed = JSON.parse(replaceVariables(defaultsProp, context)) as unknown;
      const parsedDefaults = typeof parsed === "object" && parsed !== null
        ? parsed as { input?: unknown; selected?: unknown }
        : {};
      defaults = {
        input: typeof parsedDefaults.input === "string" ? parsedDefaults.input : undefined,
        selected: Array.isArray(parsedDefaults.selected)
          ? parsedDefaults.selected.filter((item): item is string => typeof item === "string")
          : undefined,
      };
    } catch {
      // Invalid JSON
    }
  }

  const options = optionsStr
    ? optionsStr.split(",").map((o) => o.trim()).filter((o) => o.length > 0)
    : [];

  if (!promptCallbacks?.promptForDialog) {
    throw new Error("Dialog prompt callback not available");
  }

  const result = await promptCallbacks.promptForDialog(
    title,
    message,
    options,
    multiSelect,
    button1,
    button2,
    markdown,
    inputTitle,
    defaults,
    multiline
  );

  if (result === null) {
    throw new Error("Dialog cancelled by user");
  }

  if (saveTo) {
    context.variables.set(saveTo, JSON.stringify(result));
  }
}
