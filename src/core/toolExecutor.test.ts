import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import type { ToolCall } from "../types";
import { executeToolCall } from "./toolExecutor";

class MockVault {
  private files = new Map<string, TFile>();
  private contents = new Map<string, string>();

  addFile(path: string, content: string): TFile {
    const file = new TFile();
    const name = path.split("/").pop() ?? path;
    const lastDot = name.lastIndexOf(".");
    file.path = path;
    file.name = name;
    file.basename = lastDot > 0 ? name.slice(0, lastDot) : name;
    file.extension = lastDot > 0 ? name.slice(lastDot + 1) : "";
    file.stat = { size: content.length, mtime: 0, ctime: 0 };
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

  getAbstractFileByPath(path: string): TFile | null {
    return this.files.get(path) ?? null;
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.contents.get(file.path) ?? "";
  }

  async create(path: string, content: string): Promise<void> {
    this.addFile(path, content);
  }

  async createFolder(): Promise<void> {
    return undefined;
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
