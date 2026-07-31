import { describe, expect, it } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import type { ToolCall } from "../types";
import { executeToolCall } from "./toolExecutor";

class MockVault {
  private files = new Map<string, TFile>();
  private folders = new Map<string, TFolder>();
  private contents = new Map<string, string>();
  private root: TFolder;

  constructor() {
    this.root = new TFolder();
    this.root.path = "/";
    this.root.name = "/";
    this.root.children = [];
  }

  addFolder(path: string): TFolder {
    let parent = this.root;
    let currentPath = "";
    for (const segment of path.split("/").filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let folder = this.folders.get(currentPath);
      if (!folder) {
        folder = new TFolder();
        folder.path = currentPath;
        folder.name = segment;
        folder.children = [];
        folder.parent = parent;
        parent.children.push(folder);
        this.folders.set(currentPath, folder);
      }
      parent = folder;
    }
    return parent;
  }

  addFile(path: string, content: string): TFile {
    const file = new TFile();
    const name = path.split("/").pop() ?? path;
    const lastDot = name.lastIndexOf(".");
    file.path = path;
    file.name = name;
    file.basename = lastDot > 0 ? name.slice(0, lastDot) : name;
    file.extension = lastDot > 0 ? name.slice(lastDot + 1) : "";
    file.stat = { size: content.length, mtime: 0, ctime: 0 };
    const parentPath = path.substring(0, path.lastIndexOf("/"));
    const parent = parentPath ? this.addFolder(parentPath) : this.root;
    file.parent = parent;
    parent.children.push(file);
    this.files.set(path, file);
    this.contents.set(path, content);
    return file;
  }

  getFiles(): TFile[] {
    return [...this.files.values()];
  }

  getMarkdownFiles(): TFile[] {
    return this.getFiles().filter((file) => file.extension === "md");
  }

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    return this.files.get(path) ?? this.folders.get(path) ?? null;
  }

  getRoot(): TFolder {
    return this.root;
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.contents.get(file.path) ?? "";
  }

  async create(path: string, content: string): Promise<void> {
    this.addFile(path, content);
  }

  async createFolder(path: string): Promise<void> {
    this.addFolder(path);
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.contents.set(file.path, content);
    file.stat.size = content.length;
  }

  rename(oldPath: string, newPath: string): void {
    const file = this.files.get(oldPath);
    if (!file) return;
    const content = this.contents.get(oldPath) ?? "";
    this.files.delete(oldPath);
    this.contents.delete(oldPath);
    file.path = newPath;
    file.name = newPath.split("/").pop() ?? newPath;
    const lastDot = file.name.lastIndexOf(".");
    file.basename = lastDot > 0 ? file.name.slice(0, lastDot) : file.name;
    file.extension = lastDot > 0 ? file.name.slice(lastDot + 1) : "";
    this.files.set(newPath, file);
    this.contents.set(newPath, content);
  }
}

function createApp(vault: MockVault): App {
  return {
    vault,
    workspace: {
      getActiveFile: () => null,
    },
    fileManager: {
      renameFile: async (file: TFile, newPath: string) => vault.rename(file.path, newPath),
    },
  } as unknown as App;
}

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "test", name, arguments: args };
}

describe("executeToolCall vault files", () => {
  it("allows the whole vault when no allowed folders are configured", async () => {
    const vault = new MockVault();
    vault.addFile("Private/Secret.md", "secret");

    const result = await executeToolCall(call("read_note", { path: "Private/Secret.md" }), {
      app: createApp(vault),
      vaultToolAllowedFolders: [],
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe("secret");
  });

  it("blocks reads and writes outside allowed folders", async () => {
    const vault = new MockVault();
    vault.addFile("Private/Secret.md", "secret");
    const options = {
      app: createApp(vault),
      vaultToolAllowedFolders: ["Public"],
    };

    const readResult = await executeToolCall(call("read_note", { path: "Private/Secret.md" }), options);
    const createResult = await executeToolCall(call("create_note", {
      path: "Private/New.md",
      content: "private",
    }), options);

    expect(readResult.success).toBe(false);
    expect(readResult.result).toContain("Access denied");
    expect(createResult.success).toBe(false);
    expect(createResult.result).toContain("Access denied");
    expect(vault.getAbstractFileByPath("Private/New.md")).toBeNull();
  });

  it("filters search results to allowed folders", async () => {
    const vault = new MockVault();
    vault.addFile("Public/Plan.md", "shared needle");
    vault.addFile("Private/Plan.md", "private needle");

    const result = await executeToolCall(call("search_notes", { query: "needle" }), {
      app: createApp(vault),
      vaultToolAllowedFolders: ["Public"],
    });

    expect(result.success).toBe(true);
    expect(result.result).toContain("Public/Plan.md");
    expect(result.result).not.toContain("Private/Plan.md");
  });

  it("lists only the ancestor chain and descendants of a nested allowed folder", async () => {
    const vault = new MockVault();
    vault.addFolder("Public/Docs/Projects");
    vault.addFolder("Public/Private");
    vault.addFolder("Unrelated");
    const options = {
      app: createApp(vault),
      vaultToolAllowedFolders: ["Public/Docs"],
    };

    const rootResult = await executeToolCall(call("list_folders", {}), options);
    const publicResult = await executeToolCall(call("list_folders", { folder: "Public" }), options);

    expect(rootResult).toEqual({ success: true, result: "Public" });
    expect(publicResult).toEqual({ success: true, result: "Public/Docs" });
  });

  it("blocks renaming a note out of an allowed folder", async () => {
    const vault = new MockVault();
    vault.addFile("Public/Note.md", "public");

    const result = await executeToolCall(call("rename_note", {
      oldPath: "Public/Note.md",
      newPath: "Private/Note.md",
    }), {
      app: createApp(vault),
      vaultToolAllowedFolders: ["Public"],
    });

    expect(result.success).toBe(false);
    expect(result.result).toContain("Access denied");
    expect(vault.getAbstractFileByPath("Public/Note.md")).toBeInstanceOf(TFile);
  });

  it("reads Dashboard Hub Timeline activity through the dedicated AI tool", async () => {
    const vault = new MockVault();
    vault.addFile("Dashboards/Timeline/Timeline/2026-07-23.md", "2026-07-23T01:00:00.000Z\nid: memo-1\n\nMemo created");
    vault.addFile("Dashboards/Timeline/Timeline/2026-07-30.md", "2026-07-23T02:00:00.000Z\nid: event-1\n\n<!-- calendar-event: 2026-07-30 -->\n> Planned review");

    const result = await executeToolCall(call("read_timeline", { date: "2026-07-23" }), {
      app: createApp(vault),
    });

    expect(result.success).toBe(true);
    expect(result.result).toContain("Entries: 2");
    expect(result.result).toContain("Memo created");
    expect(result.result).toContain("Planned review");
  });

  it("searches non-markdown text files", async () => {
    const vault = new MockVault();
    vault.addFile("Board.canvas", '{"nodes":[{"text":"needle"}]}');
    vault.addFile("Daily.md", "plain note");
    const result = await executeToolCall(call("search_notes", { query: "needle" }), {
      app: createApp(vault),
    });

    expect(result.success).toBe(true);
    expect(result.result).toContain("Board.canvas");
  });

  it("lists non-markdown text files", async () => {
    const vault = new MockVault();
    vault.addFile("Board.canvas", "{}");
    vault.addFile("Image.png", "binary");
    const result = await executeToolCall(call("list_notes", { recursive: "true" }), {
      app: createApp(vault),
    });

    expect(result.success).toBe(true);
    expect(result.result).toContain("Board.canvas");
    expect(result.result).not.toContain("Image.png");
  });

  it("keeps explicit extension when renaming", async () => {
    const vault = new MockVault();
    vault.addFile("Board.canvas", "{}");
    const result = await executeToolCall(
      call("rename_note", { oldPath: "Board.canvas", newPath: "Archive/Board.canvas" }),
      { app: createApp(vault) },
    );

    expect(result.success).toBe(true);
    expect(vault.getAbstractFileByPath("Archive/Board.canvas")).toBeInstanceOf(TFile);
    expect(vault.getAbstractFileByPath("Archive/Board.canvas.md")).toBeNull();
  });
});
