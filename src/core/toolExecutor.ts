import { TFile, TFolder, type App } from "obsidian";
import type { ToolCall } from "../types";
import type { McpManager } from "./mcpManager";
import { getEditHistoryManager } from "./editHistory";
import { executeSandboxedJS } from "./sandboxExecutor";
import { ensureMarkdownExtensionIfMissing, getVaultTextFiles } from "./vaultFileTypes";
import { readTimelineEntriesForDay, sanitizeTimelineName } from "./timelineReader";
import {
  assertVaultToolFileAllowed,
  assertVaultToolFolderNavigable,
  assertVaultToolPathAllowed,
  isFileAllowedForVaultTools,
  isPathNavigableForVaultTools,
} from "./vaultToolScope";

export interface ToolExecutionResult {
  success: boolean;
  result: string;
  cancelled?: boolean;
}

export type ProposeEditDecision = boolean | {
  accepted: boolean;
  feedback?: string;
  cancelled?: boolean;
  openFile?: boolean;
};

// Callback for edit confirmation. A feedback-bearing rejection asks the model to revise its proposal.
export type ProposeEditCallback = (
  path: string,
  oldContent: string,
  newContent: string,
  context?: { mode: "create" | "overwrite" | "rename"; targetPath?: string },
) => Promise<ProposeEditDecision>;

// Callback for skill workflow execution
export type SkillWorkflowExecutor = (workflowId: string, variablesJson?: string) => Promise<string>;

export interface ToolExecutorOptions {
  app: App;
  onProposeEdit?: ProposeEditCallback;
  mcpManager?: McpManager;
  onRunSkillWorkflow?: SkillWorkflowExecutor;
  vaultToolAllowedFolders?: string[];
}

function rejectedEditResult(decision: ProposeEditDecision): ToolExecutionResult | null {
  const accepted = typeof decision === "boolean" ? decision : decision.accepted;
  if (accepted) return null;

  const feedback = typeof decision === "boolean" ? "" : decision.feedback?.trim() || "";
  const result: ToolExecutionResult = {
    success: false,
    result: feedback
      ? `Edit was not applied. The user requested these changes:\n${feedback}\nRevise the edit and propose it again.`
      : "Edit was rejected by the user.",
  };
  if (typeof decision !== "boolean" && decision.cancelled === true) result.cancelled = true;
  return result;
}

async function openFileIfRequested(app: App, file: TFile, decision?: ProposeEditDecision): Promise<void> {
  if (typeof decision !== "boolean" && decision?.openFile) {
    await app.workspace.getLeaf().openFile(file);
  }
}

export async function executeToolCall(
  toolCall: ToolCall,
  options: ToolExecutorOptions,
): Promise<ToolExecutionResult> {
  const { app } = options;
  const args = toolCall.arguments;
  const allowedFolders = options.vaultToolAllowedFolders;

  try {
    switch (toolCall.name) {
      case "read_timeline": {
        const timelineName = sanitizeTimelineName((args.timelineName as string | undefined) || "Timeline");
        assertVaultToolPathAllowed(`Dashboards/Timeline/${timelineName}`, allowedFolders);
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, "0");
        const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const date = (args.date as string | undefined) || today;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return { success: false, result: "date must use YYYY-MM-DD format" };
        }
        const entries = await readTimelineEntriesForDay(app.vault, timelineName, date);
        return {
          success: true,
          result: entries.length > 0
            ? `Timeline: ${timelineName}\nDate: ${date}\nEntries: ${entries.length}\n\n${entries.join("\n\n---\n\n")}`
            : `No Timeline activity found for ${date} in ${timelineName}.`,
        };
      }

      case "read_note": {
        const path = args.path as string;
        assertVaultToolPathAllowed(path, allowedFolders);
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          return { success: false, result: `File not found: ${path}` };
        }
        assertVaultToolFileAllowed(file, allowedFolders);
        const content = await app.vault.cachedRead(file);
        return { success: true, result: content };
      }

      case "create_note": {
        const path = ensureMarkdownExtensionIfMissing(args.path as string);
        assertVaultToolPathAllowed(path, allowedFolders);
        const content = args.content as string;
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing) {
          return { success: false, result: `File already exists: ${path}` };
        }
        let decision: ProposeEditDecision | undefined;
        if (options.onProposeEdit) {
          decision = await options.onProposeEdit(path, "", content, { mode: "create" });
          const rejection = rejectedEditResult(decision);
          if (rejection) return rejection;
        }
        // Ensure parent folder exists
        const parentPath = path.substring(0, path.lastIndexOf("/"));
        if (parentPath && !app.vault.getAbstractFileByPath(parentPath)) {
          await app.vault.createFolder(parentPath);
        }
        const created = await app.vault.create(path, content);
        await openFileIfRequested(app, created, decision);
        return { success: true, result: `Created: ${path}` };
      }

      case "search_notes": {
        const query = (args.query as string).toLowerCase();
        const limit = parseInt(args.limit as string || "10", 10);
        const files = getVaultTextFiles(app)
          .filter((file) => isFileAllowedForVaultTools(file, allowedFolders));
        const results: { path: string; snippet: string }[] = [];

        for (const file of files) {
          if (results.length >= limit) break;
          // Check filename
          if (file.path.toLowerCase().includes(query)) {
            const content = await app.vault.cachedRead(file);
            results.push({ path: file.path, snippet: content.slice(0, 200) });
            continue;
          }
          // Check content
          const content = await app.vault.cachedRead(file);
          const idx = content.toLowerCase().indexOf(query);
          if (idx !== -1) {
            const start = Math.max(0, idx - 50);
            const end = Math.min(content.length, idx + query.length + 150);
            results.push({ path: file.path, snippet: `...${content.slice(start, end)}...` });
          }
        }

        if (results.length === 0) {
          return { success: true, result: "No text-based vault files found matching the query." };
        }
        return {
          success: true,
          result: results.map(r => `[${r.path}]\n${r.snippet}`).join("\n\n---\n\n"),
        };
      }

      case "list_notes": {
        const folder = (args.folder as string) || "";
        if (folder) assertVaultToolPathAllowed(folder, allowedFolders);
        const recursive = (args.recursive as string) === "true";
        const files = getVaultTextFiles(app)
          .filter((file) => isFileAllowedForVaultTools(file, allowedFolders))
          .filter(f => {
            if (!folder) return recursive || !f.path.includes("/");
            if (recursive) return f.path.startsWith(folder + "/");
            const dir = f.path.substring(0, f.path.lastIndexOf("/"));
            return dir === folder;
          })
          .map(f => f.path)
          .sort();

        return { success: true, result: files.length > 0 ? files.join("\n") : "No text-based vault files found." };
      }

      case "list_folders": {
        const parentFolder = (args.folder as string) || "";
        if (parentFolder) assertVaultToolFolderNavigable(parentFolder, allowedFolders);
        const folders: string[] = [];
        const root = parentFolder
          ? app.vault.getAbstractFileByPath(parentFolder)
          : app.vault.getRoot();

        if (root instanceof TFolder) {
          for (const child of root.children) {
            if (child instanceof TFolder) {
              if (isPathNavigableForVaultTools(child.path, allowedFolders)) {
                folders.push(child.path);
              }
            }
          }
        }
        return { success: true, result: folders.length > 0 ? folders.sort().join("\n") : "No subfolders found." };
      }

      case "get_active_note": {
        const activeFile = app.workspace.getActiveFile();
        if (!activeFile) {
          return { success: true, result: "No vault file is currently open." };
        }
        assertVaultToolFileAllowed(activeFile, allowedFolders);
        const content = await app.vault.cachedRead(activeFile);
        return {
          success: true,
          result: `Path: ${activeFile.path}\nSize: ${activeFile.stat.size} bytes\nModified: ${new Date(activeFile.stat.mtime).toISOString()}\n\n${content}`,
        };
      }

      case "update_note": {
        const path = args.path as string;
        assertVaultToolPathAllowed(path, allowedFolders);
        const content = args.content as string;
        const mode = (args.mode as string) || "replace";
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          return { success: false, result: `File not found: ${path}` };
        }
        assertVaultToolFileAllowed(file, allowedFolders);
        const existing = await app.vault.cachedRead(file);
        let newContent: string;
        if (mode === "append") {
          newContent = `${existing}\n${content}`;
        } else if (mode === "prepend") {
          newContent = `${content}\n${existing}`;
        } else {
          newContent = content;
        }

        let decision: ProposeEditDecision | undefined;
        if (options.onProposeEdit) {
          decision = await options.onProposeEdit(path, existing, newContent);
          const rejection = rejectedEditResult(decision);
          if (rejection) return rejection;
        }

        const historyManager = getEditHistoryManager();
        if (historyManager) {
          await historyManager.ensureSnapshot(path);
          historyManager.saveEdit({ path, modifiedContent: newContent, source: "propose_edit" });
        }
        await app.vault.modify(file, newContent);
        await openFileIfRequested(app, file, decision);
        return { success: true, result: `Updated ${path} (${mode})` };
      }

      case "rename_note": {
        const oldPath = args.oldPath as string;
        const newPath = ensureMarkdownExtensionIfMissing(args.newPath as string);
        assertVaultToolPathAllowed(oldPath, allowedFolders);
        assertVaultToolPathAllowed(newPath, allowedFolders);
        const file = app.vault.getAbstractFileByPath(oldPath);
        if (!(file instanceof TFile)) {
          return { success: false, result: `File not found: ${oldPath}` };
        }
        assertVaultToolFileAllowed(file, allowedFolders);
        if (app.vault.getAbstractFileByPath(newPath)) {
          return { success: false, result: `File already exists: ${newPath}` };
        }
        let decision: ProposeEditDecision | undefined;
        if (options.onProposeEdit) {
          const content = await app.vault.cachedRead(file);
          decision = await options.onProposeEdit(oldPath, content, content, {
            mode: "rename",
            targetPath: newPath,
          });
          const rejection = rejectedEditResult(decision);
          if (rejection) return rejection;
        }
        await app.fileManager.renameFile(file, newPath);
        await openFileIfRequested(app, file, decision);
        return { success: true, result: `Renamed ${oldPath} → ${newPath}` };
      }

      case "create_folder": {
        const path = args.path as string;
        assertVaultToolPathAllowed(path, allowedFolders);
        if (app.vault.getAbstractFileByPath(path)) {
          return { success: false, result: `Folder already exists: ${path}` };
        }
        await app.vault.createFolder(path);
        return { success: true, result: `Created folder: ${path}` };
      }

      case "propose_edit": {
        const path = args.path as string;
        assertVaultToolPathAllowed(path, allowedFolders);
        const newContent = args.content as string;
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          return { success: false, result: `File not found: ${path}` };
        }
        assertVaultToolFileAllowed(file, allowedFolders);
        const oldContent = await app.vault.cachedRead(file);

        const saveEditHistory = async () => {
          const historyManager = getEditHistoryManager();
          if (historyManager) {
            await historyManager.ensureSnapshot(path);
            historyManager.saveEdit({ path, modifiedContent: newContent, source: "propose_edit" });
          }
        };

        if (options.onProposeEdit) {
          const decision = await options.onProposeEdit(path, oldContent, newContent);
          const rejection = rejectedEditResult(decision);
          if (rejection) return rejection;
          await saveEditHistory();
          await app.vault.modify(file, newContent);
          await openFileIfRequested(app, file, decision);
          return { success: true, result: `Edit applied to ${path}` };
        }

        // No callback - apply directly
        await saveEditHistory();
        await app.vault.modify(file, newContent);
        return { success: true, result: `Edit applied to ${path}` };
      }

      case "delete_note": {
        const path = args.path as string;
        assertVaultToolPathAllowed(path, allowedFolders);
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return { success: false, result: `File not found: ${path}` };
        assertVaultToolFileAllowed(file, allowedFolders);
        const oldContent = await app.vault.cachedRead(file);
        if (options.onProposeEdit) {
          const decision = await options.onProposeEdit(path, oldContent, "", { mode: "overwrite" });
          const rejection = rejectedEditResult(decision);
          if (rejection) return rejection;
        }
        await app.fileManager.trashFile(file);
        return { success: true, result: `Moved to trash: ${path}` };
      }

      case "bulk_propose_edit":
      case "bulk_delete_notes":
      case "bulk_rename_notes": {
        const calls: ToolCall[] = [];
        if (toolCall.name === "bulk_propose_edit") {
          for (const edit of (args.edits as Array<Record<string, unknown>> | undefined) ?? []) {
            calls.push({ id: toolCall.id, name: "propose_edit", arguments: edit });
          }
        } else if (toolCall.name === "bulk_delete_notes") {
          for (const path of (args.paths as string[] | undefined) ?? []) {
            calls.push({ id: toolCall.id, name: "delete_note", arguments: { path } });
          }
        } else {
          for (const rename of (args.renames as Array<Record<string, unknown>> | undefined) ?? []) {
            calls.push({ id: toolCall.id, name: "rename_note", arguments: rename });
          }
        }

        if (calls.length === 0) return { success: false, result: "No operations were provided." };
        const results: ToolExecutionResult[] = [];
        for (const call of calls) {
          const result = await executeToolCall(call, options);
          results.push(result);
          if (result.cancelled) {
            return { success: false, cancelled: true, result: JSON.stringify(results) };
          }
        }
        return {
          success: results.every(result => result.success),
          result: JSON.stringify(results),
        };
      }

      case "execute_javascript": {
        try {
          const code = args.code as string;
          const input = args.input as string | undefined;
          const result = await executeSandboxedJS(code, input);
          return { success: true, result };
        } catch (err) {
          return { success: false, result: err instanceof Error ? err.message : "JavaScript execution failed" };
        }
      }

      case "run_skill_workflow": {
        if (!options.onRunSkillWorkflow) {
          return { success: false, result: "Skill workflow execution is not available" };
        }
        try {
          const result = await options.onRunSkillWorkflow(
            args.workflowId as string,
            args.variables as string | undefined,
          );
          return { success: true, result };
        } catch (err) {
          return { success: false, result: `Workflow error: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      default: {
        // Try MCP tools
        if (options.mcpManager?.hasTool(toolCall.name)) {
          try {
            const result = await options.mcpManager.callTool(toolCall.name, args);
            return { success: true, result };
          } catch (err) {
            console.error("[MCP tool error]", toolCall.name, err);
            return { success: false, result: `MCP error: ${err instanceof Error ? err.message : String(err)}` };
          }
        }
        return { success: false, result: `Unknown tool: ${toolCall.name}` };
      }
    }
  } catch (err) {
    return { success: false, result: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
