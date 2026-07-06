import { describe, expect, it, vi } from "vitest";
import { TFolder, type Vault } from "obsidian";
import { ensureVaultFolder, parseDashboard } from "./dashboardFile";

vi.mock("obsidian", async () => {
  const yaml = await import("yaml");
  class MockTFolder {
    path = "";
    name = "";
    children = [];
  }
  return {
    TFolder: MockTFolder,
    parseYaml: (source: string) => yaml.parse(source),
    stringifyYaml: (value: unknown) => yaml.stringify(value),
  };
});

function folder(path: string): TFolder {
  const f = new TFolder();
  f.path = path;
  f.name = path.split("/").pop() ?? path;
  return f;
}

function makeVault(options?: {
  folders?: string[];
  files?: string[];
  staleAbstractFolders?: string[];
  staleAfterCreate?: string[];
}) {
  const folders = new Set(options?.folders ?? []);
  const files = new Set(options?.files ?? []);
  const staleAbstractFolders = new Set(options?.staleAbstractFolders ?? []);
  const staleAfterCreate = new Set(options?.staleAfterCreate ?? []);
  const created: string[] = [];

  const vault = {
    adapter: {
      stat: async (path: string) => {
        if (folders.has(path)) return { type: "folder" as const, ctime: 0, mtime: 0, size: 0 };
        if (files.has(path)) return { type: "file" as const, ctime: 0, mtime: 0, size: 0 };
        return null;
      },
    },
    getAbstractFileByPath: (path: string) => {
      if (folders.has(path) && !staleAbstractFolders.has(path)) return folder(path);
      if (files.has(path)) return { path };
      return null;
    },
    createFolder: async (path: string) => {
      if (folders.has(path) || files.has(path)) throw new Error(`already exists: ${path}`);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent && !folders.has(parent)) throw new Error(`missing parent: ${parent}`);
      folders.add(path);
      if (staleAfterCreate.has(path)) staleAbstractFolders.add(path);
      created.push(path);
    },
  } as unknown as Vault;

  return { vault, folders, created };
}

describe("ensureVaultFolder", () => {
  it("creates nested folders one segment at a time", async () => {
    const { vault, folders, created } = makeVault();

    await ensureVaultFolder(vault, "Dashboards/Data");

    expect([...folders]).toEqual(["Dashboards", "Dashboards/Data"]);
    expect(created).toEqual(["Dashboards", "Dashboards/Data"]);
  });

  it("accepts folders that exist in the adapter before the abstract cache updates", async () => {
    const { vault, created } = makeVault({
      folders: ["Dashboards", "Dashboards/Data"],
      staleAbstractFolders: ["Dashboards/Data"],
    });

    await expect(ensureVaultFolder(vault, "Dashboards/Data")).resolves.toBeUndefined();
    expect(created).toEqual([]);
  });

  it("accepts folders created successfully before the abstract cache updates", async () => {
    const { vault, created } = makeVault({
      folders: ["Dashboards"],
      staleAfterCreate: ["Dashboards/Data"],
    });

    await expect(ensureVaultFolder(vault, "Dashboards/Data")).resolves.toBeUndefined();
    expect(created).toEqual(["Dashboards/Data"]);
  });
});

describe("parseDashboard", () => {
  it("treats legacy markdown widgets as file widgets", () => {
    const parsed = parseDashboard(`
version: 1
grid:
  cols: 12
  rowHeight: 72
  gap: 8
widgets:
  - id: note
    type: markdown
    layout:
      lg:
        x: 0
        y: 0
        w: 6
        h: 3
    config:
      path: Notes/example.md
`);

    expect(parsed?.widgets[0]?.type).toBe("file");
    expect(parsed?.widgets[0]?.config).toEqual({ path: "Notes/example.md" });
  });
});
