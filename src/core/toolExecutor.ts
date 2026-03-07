import { TFile, TFolder, type App } from "obsidian";
import type { ToolCall } from "../types";
import type { McpManager } from "./mcpManager";

export interface ToolExecutionResult {
  success: boolean;
  result: string;
}

// Callback for propose_edit confirmation
export type ProposeEditCallback = (path: string, oldContent: string, newContent: string) => Promise<boolean>;

// Callback for skill workflow execution
export type SkillWorkflowExecutor = (workflowId: string, variablesJson?: string) => Promise<string>;

export interface ToolExecutorOptions {
  app: App;
  onProposeEdit?: ProposeEditCallback;
  mcpManager?: McpManager;
  onRunSkillWorkflow?: SkillWorkflowExecutor;
}

export async function executeToolCall(
  toolCall: ToolCall,
  options: ToolExecutorOptions,
): Promise<ToolExecutionResult> {
  const { app } = options;
  const args = toolCall.arguments;

  try {
    switch (toolCall.name) {
      case "read_note": {
        const path = args.path as string;
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          return { success: false, result: `File not found: ${path}` };
        }
        const content = await app.vault.cachedRead(file);
        return { success: true, result: content };
      }

      case "create_note": {
        const path = args.path as string;
        const content = args.content as string;
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing) {
          return { success: false, result: `File already exists: ${path}` };
        }
        // Ensure parent folder exists
        const parentPath = path.substring(0, path.lastIndexOf("/"));
        if (parentPath && !app.vault.getAbstractFileByPath(parentPath)) {
          await app.vault.createFolder(parentPath);
        }
        await app.vault.create(path, content);
        return { success: true, result: `Created: ${path}` };
      }

      case "search_notes": {
        const query = (args.query as string).toLowerCase();
        const limit = parseInt(args.limit as string || "10", 10);
        const files = app.vault.getMarkdownFiles();
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
          return { success: true, result: "No notes found matching the query." };
        }
        return {
          success: true,
          result: results.map(r => `[${r.path}]\n${r.snippet}`).join("\n\n---\n\n"),
        };
      }

      case "list_notes": {
        const folder = (args.folder as string) || "";
        const recursive = (args.recursive as string) === "true";
        const files = app.vault.getMarkdownFiles()
          .filter(f => {
            if (!folder) return recursive || !f.path.includes("/");
            if (recursive) return f.path.startsWith(folder + "/");
            const dir = f.path.substring(0, f.path.lastIndexOf("/"));
            return dir === folder;
          })
          .map(f => f.path)
          .sort();

        return { success: true, result: files.length > 0 ? files.join("\n") : "No notes found." };
      }

      case "list_folders": {
        const parentFolder = (args.folder as string) || "";
        const folders: string[] = [];
        const root = parentFolder
          ? app.vault.getAbstractFileByPath(parentFolder)
          : app.vault.getRoot();

        if (root instanceof TFolder) {
          for (const child of root.children) {
            if (child instanceof TFolder) {
              folders.push(child.path);
            }
          }
        }
        return { success: true, result: folders.length > 0 ? folders.sort().join("\n") : "No subfolders found." };
      }

      case "get_active_note": {
        const activeFile = app.workspace.getActiveFile();
        if (!activeFile) {
          return { success: true, result: "No note is currently open." };
        }
        const content = await app.vault.cachedRead(activeFile);
        return {
          success: true,
          result: `Path: ${activeFile.path}\nSize: ${activeFile.stat.size} bytes\nModified: ${new Date(activeFile.stat.mtime).toISOString()}\n\n${content}`,
        };
      }

      case "update_note": {
        const path = args.path as string;
        const content = args.content as string;
        const mode = (args.mode as string) || "replace";
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          return { success: false, result: `File not found: ${path}` };
        }
        const existing = await app.vault.cachedRead(file);
        let newContent: string;
        if (mode === "append") {
          newContent = `${existing}\n${content}`;
        } else if (mode === "prepend") {
          newContent = `${content}\n${existing}`;
        } else {
          newContent = content;
        }
        await app.vault.modify(file, newContent);
        return { success: true, result: `Updated ${path} (${mode})` };
      }

      case "rename_note": {
        const oldPath = args.oldPath as string;
        let newPath = args.newPath as string;
        const file = app.vault.getAbstractFileByPath(oldPath);
        if (!(file instanceof TFile)) {
          return { success: false, result: `File not found: ${oldPath}` };
        }
        if (!newPath.endsWith(".md")) {
          newPath += ".md";
        }
        if (app.vault.getAbstractFileByPath(newPath)) {
          return { success: false, result: `File already exists: ${newPath}` };
        }
        await app.fileManager.renameFile(file, newPath);
        return { success: true, result: `Renamed ${oldPath} → ${newPath}` };
      }

      case "create_folder": {
        const path = args.path as string;
        if (app.vault.getAbstractFileByPath(path)) {
          return { success: false, result: `Folder already exists: ${path}` };
        }
        await app.vault.createFolder(path);
        return { success: true, result: `Created folder: ${path}` };
      }

      case "propose_edit": {
        const path = args.path as string;
        const newContent = args.content as string;
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          return { success: false, result: `File not found: ${path}` };
        }
        const oldContent = await app.vault.cachedRead(file);

        if (options.onProposeEdit) {
          const accepted = await options.onProposeEdit(path, oldContent, newContent);
          if (accepted) {
            await app.vault.modify(file, newContent);
            return { success: true, result: `Edit applied to ${path}` };
          }
          return { success: false, result: "Edit was rejected by the user." };
        }

        // No callback - apply directly
        await app.vault.modify(file, newContent);
        return { success: true, result: `Edit applied to ${path}` };
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
