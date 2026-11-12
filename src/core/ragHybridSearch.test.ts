import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { ChunkBm25Index } from "obsidian-llm-hub-common/core";
import { DEFAULT_RAG_SETTING, type RagSetting } from "../types";
import { type RagIndex, type ChunkMeta } from "./ragStorage";
import { getRagStore as initLocalRagStore, searchLocalRagResults as retrieve } from "./ragStore";
import { DEFAULT_LOCAL_LLM_CONFIG } from "../types";
function resetLocalRagStore() {
  for (const name of ["test", "second", "combined", "external"]) initLocalRagStore().invalidateEntry(name);
}
let activeApp: App;
let settingExtensions: string[] | undefined;
function searchLocalRagResults(name: string, query: string, setting: RagSetting, _key: string) {
  return retrieve(name, query, setting, DEFAULT_LOCAL_LLM_CONFIG, activeApp, settingExtensions);
}

const mocks = vi.hoisted(() => ({ native: vi.fn(), compatible: vi.fn(), externalIndex: vi.fn(), externalVectors: vi.fn() }));
vi.mock("./embeddingProvider", async original => ({
  ...await original<object>(), generateEmbeddings: mocks.native, generateEmbedding: mocks.compatible,
}));
vi.mock("./ragStorage", async original => ({
  ...await original<object>(), loadExternalRagIndex: mocks.externalIndex, loadExternalRagVectors: mocks.externalVectors,
}));

const meta: ChunkMeta[] = [
  { filePath: "semantic.md", startOffset: 0, text: "Semantically related document" },
  { filePath: "exact.md", startOffset: 0, text: "PRJ-123" },
  { filePath: "both.txt", startOffset: 0, text: "PRJ-123 context extra details" },
];
const index: RagIndex = { meta, dimension: 2, fileChecksums: {}, embeddingFormatVersion: 2, chunkSize: 1000, chunkOverlap: 200 };
const vectors = new Float32Array([1, 0, 0, 1, 0.8, 0.6]);

function fixture() {
  const disk = new Map<string, string | ArrayBuffer>([
    ["LocalLlmHub/rag/test/rag-index.json", JSON.stringify(index)],
    ["LocalLlmHub/rag/test/rag-vectors.bin", vectors.buffer],
  ]);
  const files: TFile[] = [];
  const contents = new Map<string, string>();
  const adapter = {
    exists: vi.fn(async (path: string) => disk.has(path)),
    mkdir: vi.fn(async (path: string) => { disk.set(path, ""); }),
    read: vi.fn(async (path: string) => disk.get(path) as string),
    readBinary: vi.fn(async (path: string) => disk.get(path) as ArrayBuffer),
    write: vi.fn(async (path: string, value: string) => { disk.set(path, value); }),
    writeBinary: vi.fn(async (path: string, value: ArrayBuffer) => { disk.set(path, value); }),
    remove: vi.fn(async (path: string) => { disk.delete(path); }),
    rmdir: vi.fn(async (path: string) => { for (const key of disk.keys()) if (key.startsWith(path + "/")) disk.delete(key); }),
  };
  const app = { vault: { adapter, getFiles: () => files,
    getAbstractFileByPath: (path: string) => files.find(file => file.path === path),
    createFolder: async (path: string) => { disk.set(path, ""); },
    cachedRead: async (file: TFile) => contents.get(file.path)!,
  } } as unknown as App;
  activeApp = app;
  const setting = { ...DEFAULT_RAG_SETTING, embeddingModel: "test", embeddingBaseUrl: "http://embedding", topK: 5 };
  return { disk, files, contents, adapter, app, setting };
}

beforeEach(() => {
  resetLocalRagStore(); vi.resetAllMocks();
  mocks.native.mockImplementation(async inputs => inputs.map(() => [1, 0]));
  mocks.compatible.mockResolvedValue([1, 0]);
  settingExtensions = undefined;
});
afterEach(() => resetLocalRagStore());

describe("hybrid local RAG retrieval", () => {
  async function search(f: ReturnType<typeof fixture>, overrides: Partial<RagSetting> = {}) {
    const setting = { ...f.setting, ...overrides };
    await initLocalRagStore().load(f.app, ["test"], { test: setting });
    return searchLocalRagResults("test", "PRJ-123", setting, "key");
  }

  it("preserves vector-only scores, ordering and strict threshold without BM25 I/O", async () => {
    const f = fixture();
    const results = await search(f, { minScore: 0.5 });
    expect(results.map(r => r.filePath)).toEqual(["semantic.md", "both.txt"]);
    expect(results[0].score).toBe(1);
    expect(results.every(result => result.retrievalSource === undefined)).toBe(true);
    expect(results[1].score).toBeCloseTo(0.8);
    expect(f.adapter.exists.mock.calls.some(([path]) => path.endsWith("bm25.json"))).toBe(false);
    expect(f.adapter.write).not.toHaveBeenCalled();
  });

  it("retains BM25-only matches below the vector threshold, then limits fused results", async () => {
    const f = fixture();
    const results = await search(f, { hybridSearch: true, minScore: 0.95, topK: 2 });
    expect(results.map(r => r.filePath)).toEqual(["semantic.md", "exact.md"]);
    expect(results.map(r => r.score)).toEqual([1 / 61, 1 / 61]);
    expect(results.map(r => r.retrievalSource)).toEqual(["vector", "bm25"]);
    expect(f.disk.has("LocalLlmHub/rag/test/bm25.json")).toBe(true);
    expect(mocks.compatible).toHaveBeenCalledTimes(1); // query only, no re-embedding
  });

  it("promotes a candidate found in both rankings and filters extensions before BM25 topK", async () => {
    const f = fixture();
    expect((await search(f, { hybridSearch: true })).at(0)?.filePath).toBe("both.txt");
    resetLocalRagStore();
    settingExtensions = [".TXT"];
    const filtered = await search(f, { hybridSearch: true, hybridCandidateK: 1 });
    expect(filtered.map(r => r.filePath)).toEqual(["both.txt"]);
    expect(filtered[0].score).toBe(2 / 61);
    expect(filtered[0].retrievalSource).toBe("both");
  });

  it.each([undefined, '{"version":0}', '{invalid', '{"version":1,"tokenizer":"obsolete"}'])(
    "automatically builds/rebuilds a missing or old sidecar (%s)", async cache => {
      const f = fixture();
      if (cache) f.disk.set("LocalLlmHub/rag/test/bm25.json", cache);
      const results = await search(f, { hybridSearch: true });
      expect(results.some(r => r.filePath === "exact.md")).toBe(true);
      expect(JSON.parse(f.disk.get("LocalLlmHub/rag/test/bm25.json") as string).version).toBe(1);
      expect(mocks.compatible).toHaveBeenCalledTimes(1);
    },
  );

  it("builds combined and multiple external indexes in memory without sidecar writes", async () => {
    const f = fixture();
    const store = initLocalRagStore();
    f.disk.set("LocalLlmHub/rag/second/rag-index.json", JSON.stringify({ ...index, meta: [{ ...meta[1], filePath: "second.md" }] }));
    f.disk.set("LocalLlmHub/rag/second/rag-vectors.bin", new Float32Array([0, 1]).buffer);
    const combined = { ...f.setting, hybridSearch: true, sourceRagSettings: ["test", "second"] };
    await store.load(f.app, ["combined"], { combined });
    const results = await searchLocalRagResults("combined", "PRJ-123", combined, "key");
    expect(results.map(r => r.filePath)).toContain("second.md");
    expect(f.adapter.write).not.toHaveBeenCalled();
    resetLocalRagStore();
    mocks.externalIndex.mockResolvedValue(index);
    mocks.externalVectors.mockResolvedValue(vectors);
    const external = { ...f.setting, hybridSearch: true, topK: 10, externalIndexPath: "/a\n/b" };
    await initLocalRagStore().load(f.app, ["external"], { external });
    mocks.externalIndex.mockClear();
    const matches = await searchLocalRagResults("external", "PRJ-123", external, "key");
    expect(matches.filter(r => r.filePath === "exact.md")).toHaveLength(2);
    expect(mocks.externalIndex).toHaveBeenCalledTimes(2);
    expect(f.adapter.write).not.toHaveBeenCalled();
  });

  it("updates the BM25 sidecar on sync additions, edits and deletion, skipping unchanged embeddings", async () => {
    const f = fixture();
    f.disk.clear();
    const add = (path: string, text: string) => {
      f.files.push(Object.assign(new TFile(), { path, name: path, extension: "md" }));
      f.contents.set(path, text);
    };
    add("a.md", "alpha"); add("b.md", "beta");
    const store = initLocalRagStore();
    const sync = (enabled = true) => store.sync(f.app, "test", { ...f.setting, hybridSearch: enabled }, DEFAULT_LOCAL_LLM_CONFIG);
    await sync();
    mocks.native.mockClear();
    await sync();
    expect(mocks.native).not.toHaveBeenCalled();
    f.contents.set("a.md", "updated");
    f.files.splice(f.files.findIndex(file => file.path === "b.md"), 1);
    add("c.md", "gamma");
    await sync();
    expect(mocks.native).toHaveBeenCalledTimes(1);
    expect(mocks.native.mock.calls[0][0]).toHaveLength(2);
    const newIndex = JSON.parse(f.disk.get("LocalLlmHub/rag/test/rag-index.json") as string) as RagIndex;
    const snapshot = JSON.parse(f.disk.get("LocalLlmHub/rag/test/bm25.json") as string);
    const bm25 = new ChunkBm25Index(newIndex.meta, snapshot);
    expect(bm25.search("alpha beta", 10)).toEqual([]);
    expect(bm25.search("updated gamma", 10)).toHaveLength(2);
    const sidecar = f.disk.get("LocalLlmHub/rag/test/bm25.json");
    f.contents.set("a.md", "offmode");
    await sync(false);
    expect(f.disk.get("LocalLlmHub/rag/test/bm25.json")).toBe(sidecar);
    store.invalidateEntry("test");
    const results = await searchLocalRagResults("test", "offmode", { ...f.setting, hybridSearch: true }, "key");
    expect(results.some(r => r.text === "offmode")).toBe(true);
    expect(f.disk.get("LocalLlmHub/rag/test/bm25.json")).not.toBe(sidecar);
  });

  it("updates BM25 on single-file edits, renames and removal, invalidating a combined corpus", async () => {
    const f = fixture();
    f.disk.clear();
    const a = Object.assign(new TFile(), { path: "a.md", name: "a.md", extension: "md" });
    f.files.push(a); f.contents.set(a.path, "alpha");
    const setting = { ...f.setting, hybridSearch: true };
    const store = initLocalRagStore();
    await store.sync(f.app, "test", setting, DEFAULT_LOCAL_LLM_CONFIG);
    const combined = { ...setting, sourceRagSettings: ["test"] };
    expect((await searchLocalRagResults("combined", "alpha", combined, "key")).map(r => r.text)).toEqual(["alpha"]);
    f.contents.set(a.path, "updated");
    await store.syncFile(f.app, "test", setting, DEFAULT_LOCAL_LLM_CONFIG, a.path);
    expect((await searchLocalRagResults("combined", "updated", combined, "key")).map(r => r.text)).toEqual(["updated"]);
    a.path = "renamed.md"; f.contents.set(a.path, "renamed");
    await store.syncFile(f.app, "test", setting, DEFAULT_LOCAL_LLM_CONFIG, a.path, "a.md");
    expect((await searchLocalRagResults("test", "renamed", setting, "key")).map(r => r.filePath)).toEqual([a.path]);
    f.files.splice(0);
    await store.syncFile(f.app, "test", setting, DEFAULT_LOCAL_LLM_CONFIG, a.path);
    expect(await searchLocalRagResults("test", "renamed", setting, "key")).toEqual([]);
    const snapshot = JSON.parse(f.disk.get("LocalLlmHub/rag/test/bm25.json") as string);
    expect(snapshot.documents).toEqual([]);
  });
});
