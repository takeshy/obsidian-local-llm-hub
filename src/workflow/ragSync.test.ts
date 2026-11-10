import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { WorkflowExecutor, type ExecutionLog, type WorkflowNode } from "obsidian-llm-hub-common/workflow";
import type { LocalLlmHubPlugin } from "../plugin";
import { DEFAULT_RAG_SETTING, DEFAULT_SETTINGS, type RagSetting } from "../types";
import { getRagStore } from "../core/ragStore";
import { configureLocalWorkflowHost } from "./host";
import { parseWorkflowFromMarkdown } from "./parser";

vi.mock("obsidian", async (importOriginal) => {
  const yaml = await import("yaml");
  return {
    ...(await importOriginal<typeof import("obsidian")>()),
    parseYaml: (source: string) => yaml.parse(source),
    stringifyYaml: (value: unknown) => yaml.stringify(value),
  };
});

const embeddings = vi.hoisted(() => vi.fn());
vi.mock("../core/embeddingProvider", () => ({ generateEmbeddings: embeddings }));

describe("rag-sync workflow host", () => {
  let app: App;
  let plugin: LocalLlmHubPlugin;
  let files: TFile[];
  let contents: Map<string, string | ArrayBuffer>;
  let ragSetting: RagSetting;

  beforeEach(() => {
    vi.stubGlobal("window", globalThis);
    files = [];
    contents = new Map();
    ragSetting = { ...DEFAULT_RAG_SETTING };
    embeddings.mockReset();
    embeddings.mockImplementation(async (texts: string[]) => texts.map(() => [1, 0.5]));
    app = {
      vault: {
        getFiles: () => files,
        getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
        cachedRead: async (file: TFile) => contents.get(file.path),
        createFolder: async () => undefined,
        adapter: {
          exists: async (path: string) => contents.has(path),
          read: async (path: string) => contents.get(path),
          readBinary: async (path: string) => contents.get(path),
          write: async (path: string, data: string) => { contents.set(path, data); },
          writeBinary: async (path: string, data: ArrayBuffer) => { contents.set(path, data); },
        },
      },
    } as unknown as App;
    plugin = {
      settings: { ...DEFAULT_SETTINGS },
      manifest: { version: "test" },
      getSelectedRagSettingName: () => "notes",
      getRagSetting: (name: string) => name === "notes" ? ragSetting : null,
    } as unknown as LocalLlmHubPlugin;
    getRagStore().workspaceFolder = plugin.settings.workspaceFolder;
    getRagStore().invalidateEntry("notes");
    configureLocalWorkflowHost(plugin);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function addFile(path: string, content = "A note to index"): void {
    const file = new TFile();
    Object.assign(file, { path, name: path.split("/").pop(), extension: "md" });
    files.push(file);
    contents.set(path, content);
  }

  function run(properties: Record<string, string> = {}, variables = new Map<string, string | number>(), signal?: AbortSignal, logs?: ExecutionLog[]) {
    const node: WorkflowNode = { id: "sync", type: "rag-sync", canvasNodeId: "sync", properties };
    return new WorkflowExecutor(app).execute(
      { nodes: new Map([[node.id, node]]), edges: [], startNode: node.id },
      { variables },
      log => logs?.push(log),
      { abortSignal: signal },
    );
  }

  function readIndex() {
    const base = `${plugin.settings.workspaceFolder}/rag/notes`;
    expect(contents.get(`${base}/rag-vectors.bin`)).toBeInstanceOf(ArrayBuffer);
    return JSON.parse(String(contents.get(`${base}/rag-index.json`)));
  }

  it("writes and refreshes the index through the registered host with an empty path", async () => {
    addFile("Notes/one.md", "Original note");
    const first = await run({ path: "", saveTo: "result" });
    expect(readIndex().meta[0].text).toBe("Original note");
    expect(JSON.parse(String(first.context.variables.get("result")))).toMatchObject({
      totalChunks: 1, indexedFiles: 1, syncedAt: expect.any(Number),
    });

    contents.set("Notes/one.md", "Updated note");
    await run({ ragSetting: "notes" });
    expect(readIndex().meta[0].text).toBe("Updated note");
  });

  it("finishes a full sync with more than 50 changed files", async () => {
    for (let i = 0; i < 51; i++) addFile(`Notes/${i}.md`);
    const result = await run({ saveTo: "result" });
    expect(Object.keys(readIndex().fileChecksums)).toHaveLength(51);
    expect(JSON.parse(String(result.context.variables.get("result")))).toMatchObject({
      indexedFiles: 51, deferredFiles: 0,
    });
  });

  it.each(["", '    path: ""\n'])("executes the documented YAML with an omitted or empty path: %s", async pathProperty => {
    addFile("Notes/one.md");
    const workflow = parseWorkflowFromMarkdown('```llm-workflow\nnodes:\n  - id: sync-to-rag\n    type: rag-sync\n    ragSetting: notes\n' + pathProperty + '    saveTo: syncResult\n```');
    const result = await new WorkflowExecutor(app).execute(workflow, { variables: new Map() });

    expect(Object.keys(readIndex().fileChecksums)).toEqual(["Notes/one.md"]);
    expect(JSON.parse(String(result.context.variables.get("syncResult")))).toMatchObject({ indexedFiles: 1 });
  });

  it.each(["", "Notes/one.md"])("resolves the RAG setting from variables for path %s", async path => {
    addFile("Notes/one.md");
    plugin.getSelectedRagSettingName = () => "a-different-setting";
    await run({ ragSetting: "{{settingName}}", path }, new Map([["settingName", "notes"]]));

    expect(Object.keys(readIndex().fileChecksums)).toEqual(["Notes/one.md"]);
  });

  it.each(["", " \n"])("uses the selected setting and logs it when the variable resolves to blank: %j", async value => {
    addFile("Notes/one.md");
    const logs: ExecutionLog[] = [];
    await run({ ragSetting: "{{settingName}}" }, new Map([["settingName", value]]), undefined, logs);

    expect(Object.keys(readIndex().fileChecksums)).toEqual(["Notes/one.md"]);
    expect(logs.find(log => log.status === "success")?.input).toMatchObject({ ragSetting: "notes" });
  });

  it("trims whitespace around a resolved RAG setting name", async () => {
    addFile("Notes/one.md");
    plugin.getSelectedRagSettingName = () => "a-different-setting";
    await run({ ragSetting: "{{settingName}}" }, new Map([["settingName", " notes\n"]]));

    expect(Object.keys(readIndex().fileChecksums)).toEqual(["Notes/one.md"]);
  });

  it("reports an unknown resolved RAG setting instead of falling back", async () => {
    await expect(run({ ragSetting: "{{settingName}}" }, new Map([["settingName", "missing"]])))
      .rejects.toThrow('RAG setting "missing" not found');
    expect(embeddings).not.toHaveBeenCalled();
  });

  it("restores file sync, resolves event paths and removes renamed entries", async () => {
    addFile("Notes/old.md");
    addFile("Notes/other.md");
    await run({ path: "Notes/old.md" });
    expect(Object.keys(readIndex().fileChecksums)).toEqual(["Notes/old.md"]);

    files = files.filter(file => file.path !== "Notes/old.md");
    addFile("Notes/new.md");
    const result = await run({ path: "{{_eventFilePath}}", oldPath: "{{_eventOldPath}}", saveTo: "result" }, new Map([
      ["_eventFilePath", "Notes/new.md"], ["_eventOldPath", "Notes/old.md"],
    ]));
    expect(Object.keys(readIndex().fileChecksums)).toEqual(["Notes/new.md"]);
    expect(JSON.parse(String(result.context.variables.get("result")))).toMatchObject({
      path: "Notes/new.md", syncedAt: expect.any(String),
    });
  });

  it.each(["full", "file"])("reports %s sync failures instead of logging success", async mode => {
    addFile("Notes/one.md");
    embeddings.mockRejectedValue(new Error("Embedding server unavailable"));
    const logs: ExecutionLog[] = [];
    await expect(run({ path: mode === "file" ? "Notes/one.md" : "", saveTo: "result" }, undefined, undefined, logs))
      .rejects.toThrow("Embedding server unavailable");
    expect(logs.some(log => log.nodeId === "sync" && log.status === "error")).toBe(true);
    expect(logs.some(log => log.nodeId === "sync" && log.status === "success")).toBe(false);
  });

  it("fails when no RAG setting is selected", async () => {
    plugin.getSelectedRagSettingName = () => null;
    await expect(run()).rejects.toThrow("No RAG setting selected");
    expect(embeddings).not.toHaveBeenCalled();
  });

  it("fails for an unknown explicit RAG setting instead of falling back", async () => {
    await expect(run({ ragSetting: "missing" })).rejects.toThrow('RAG setting "missing" not found');
    expect(embeddings).not.toHaveBeenCalled();
  });

  it.each([
    { externalIndexPath: "/external/index" },
    { sourceRagSettings: ["source"] },
  ])("rejects a read-only RAG setting: %o", async overrides => {
    Object.assign(ragSetting, overrides);
    await expect(run()).rejects.toThrow("not a writable local index");
    expect(embeddings).not.toHaveBeenCalled();
  });

  it("passes cancellation to an active full sync", async () => {
    addFile("Notes/one.md");
    const controller = new AbortController();
    const sync = vi.spyOn(getRagStore(), "sync").mockImplementation(async (_app, _name, _setting, _config, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      signal?.throwIfAborted();
      throw new Error("Expected abort");
    });
    await expect(run({}, undefined, controller.signal)).rejects.toThrow();
    expect(sync).toHaveBeenCalledOnce();
    expect(embeddings).not.toHaveBeenCalled();
  });
});
