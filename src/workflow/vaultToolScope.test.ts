import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { handleNoteNode, handleNoteReadNode, handleNoteSearchNode } from "./handlers/note";
import { handleFileExplorerNode, handleFileSaveNode } from "./handlers/file";
import { handleObsidianCommandNode } from "./handlers/integration";
import { handlePromptFileNode, handlePromptSelectionNode } from "./handlers/prompt";
import type { ExecutionContext, WorkflowNode } from "./types";

function makeFile(path: string, content = ""): TFile {
  const file = new TFile();
  const name = path.split("/").pop() ?? path;
  const lastDot = name.lastIndexOf(".");
  file.path = path;
  file.name = name;
  file.basename = lastDot > 0 ? name.slice(0, lastDot) : name;
  file.extension = lastDot > 0 ? name.slice(lastDot + 1) : "";
  file.stat = { size: content.length, ctime: 1, mtime: 1 };
  (file as TFile & { _content: string })._content = content;
  return file;
}

function makeApp(files: TFile[]): App {
  return {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
      read: async (file: TFile) => (file as TFile & { _content: string })._content,
      cachedRead: async (file: TFile) => (file as TFile & { _content: string })._content,
      create: async () => undefined,
      createFolder: async () => undefined,
    },
    metadataCache: { getCache: () => null },
    workspace: {
      iterateAllLeaves: () => undefined,
      getLeaf: () => ({ openFile: async () => undefined }),
      setActiveLeaf: () => undefined,
    },
    commands: {
      commands: { "editor:save-file": {} },
      executeCommandById: async () => undefined,
    },
  } as unknown as App;
}

function makeContext(allowedFolders?: string[]): ExecutionContext {
  return { variables: new Map(), logs: [], cloudVaultToolAllowedFolders: allowedFolders };
}

function makeNode(type: WorkflowNode["type"], properties: Record<string, string>): WorkflowNode {
  return { id: "node", type, canvasNodeId: "canvas-node", properties };
}

describe("LLM-triggered workflow vault scope", () => {
  it("blocks note reads and writes outside configured folders", async () => {
    const app = makeApp([makeFile("Private/Secret.md", "secret")]);
    const context = makeContext(["Public"]);

    await expect(handleNoteReadNode(
      makeNode("note-read", { path: "Private/Secret.md", saveTo: "content" }),
      context,
      app,
    )).rejects.toThrow("Access denied");
    await expect(handleNoteNode(
      makeNode("note", { path: "Private/New.md", content: "private", confirm: "false" }),
      context,
      app,
    )).rejects.toThrow("Access denied");
  });

  it("filters note-search results to configured folders", async () => {
    const app = makeApp([
      makeFile("Public/Plan.md", "roadmap"),
      makeFile("Private/Plan.md", "roadmap"),
    ]);
    const context = makeContext(["Public"]);

    await handleNoteSearchNode(makeNode("note-search", {
      query: "Plan",
      saveTo: "results",
    }), context, app);

    expect(JSON.parse(String(context.variables.get("results")))).toEqual([
      { name: "Plan", path: "Public/Plan.md" },
    ]);
  });

  it("blocks prompted and selected files outside configured folders", async () => {
    const app = makeApp([makeFile("Private/Secret.md", "secret")]);
    const context = makeContext(["Public"]);

    await expect(handlePromptFileNode(
      makeNode("prompt-file", { saveTo: "content" }),
      context,
      app,
      { promptForFile: async () => "Private/Secret.md" } as never,
    )).rejects.toThrow("Access denied");
    await expect(handlePromptSelectionNode(
      makeNode("prompt-selection", { saveTo: "selection" }),
      context,
      app,
      {
        promptForSelection: async () => ({
          path: "Private/Secret.md",
          start: { line: 0, ch: 0 },
          end: { line: 0, ch: 6 },
        }),
      } as never,
    )).rejects.toThrow("Access denied");
  });

  it("blocks file-explorer reads and file-save writes outside configured folders", async () => {
    const app = makeApp([makeFile("Private/Secret.md", "secret")]);
    const context = makeContext(["Public"]);

    await expect(handleFileExplorerNode(
      makeNode("file-explorer", { path: "Private/Secret.md", saveTo: "file" }),
      context,
      app,
    )).rejects.toThrow("Access denied");

    context.variables.set("file", JSON.stringify({
      path: "Public/Note.md",
      basename: "Note.md",
      name: "Note",
      extension: "md",
      mimeType: "text/markdown",
      contentType: "text",
      data: "content",
    }));
    await expect(handleFileSaveNode(
      makeNode("file-save", { source: "file", path: "Private/Secret.md" }),
      context,
      app,
    )).rejects.toThrow("Access denied");
  });

  it("blocks obsidian-command paths outside configured folders", async () => {
    const app = makeApp([makeFile("Private/Secret.md", "secret")]);
    await expect(handleObsidianCommandNode(
      makeNode("obsidian-command", {
        command: "editor:save-file",
        path: "Private/Secret.md",
      }),
      makeContext(["Public"]),
      app,
    )).rejects.toThrow("Access denied");
  });

  it("blocks pathless Obsidian commands when a folder scope is active", async () => {
    const app = makeApp([]);

    await expect(handleObsidianCommandNode(
      makeNode("obsidian-command", { command: "editor:save-file" }),
      makeContext(["Public"]),
      app,
    )).rejects.toThrow("Access denied");
  });

  it("keeps pathless Obsidian commands available for unscoped workflows", async () => {
    const app = makeApp([]);

    await expect(handleObsidianCommandNode(
      makeNode("obsidian-command", { command: "editor:save-file" }),
      makeContext(),
      app,
    )).resolves.toBeUndefined();
  });
});
