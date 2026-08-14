import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkspaceStateManager } from "./workspaceStateManager";
import type { RagConfig } from "../types";

function createAppMock() {
  const exists = vi.fn(async () => false);
  const read = vi.fn(async () => "");
  const write = vi.fn(async () => undefined);
  const createFolder = vi.fn(async () => undefined);

  return {
    app: {
      vault: {
        adapter: { exists, read, write },
        createFolder,
      },
    },
    exists,
    read,
    write,
    createFolder,
  };
}

function createEmitter() {
  return { emit: vi.fn() };
}

describe("WorkspaceStateManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("saveWorkspaceState", () => {
    it("creates each parent of a nested workspace folder", async () => {
      const { app, createFolder, write } = createAppMock();
      const manager = new WorkspaceStateManager(app as never, createEmitter() as never, () => "plugin/data");

      await manager.saveWorkspaceState();

      expect(createFolder.mock.calls).toEqual([["plugin"], ["plugin/data"]]);
      expect(write).toHaveBeenCalledWith(
        "plugin/data/workspace-state.json",
        expect.any(String),
      );
    });
  });

  describe("migrateFromRagConfig", () => {
    it("migrates a disabled legacy ragConfig without auto-selecting it", async () => {
      const { app, write } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      const ragConfig: RagConfig = {
        enabled: false,
        embeddingModel: "nomic-embed-text",
        embeddingBaseUrl: "",
        targetFolders: ["notes"],
        excludePatterns: ["archive"],
        chunkSize: 1000,
        chunkOverlap: 200,
        topK: 5,
        minScore: 0.4,
        externalIndexPath: "/tmp/external-index",
      };

      const migrated = await manager.migrateFromRagConfig(ragConfig);

      expect(migrated).toBe(true);
      expect(manager.getRagSettingNames()).toEqual(["Default"]);
      expect(manager.getSelectedRagSetting()).toBeNull();
      expect(manager.getRagSetting("Default")).toMatchObject({
        embeddingModel: "nomic-embed-text",
        targetFolders: ["notes"],
        excludePatterns: ["archive"],
        minScore: 0.4,
        externalIndexPath: "/tmp/external-index",
      });
      expect(write).toHaveBeenCalled();
    });

    it("migrates an enabled legacy ragConfig with auto-select", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      const ragConfig: RagConfig = {
        enabled: true,
        embeddingModel: "nomic-embed-text",
        embeddingBaseUrl: "",
        targetFolders: [],
        excludePatterns: [],
        chunkSize: 1000,
        chunkOverlap: 200,
        topK: 5,
        minScore: 0.3,
      };

      const migrated = await manager.migrateFromRagConfig(ragConfig);

      expect(migrated).toBe(true);
      expect(manager.workspaceState.selectedRagSetting).toBe("Default");
      expect(manager.getSelectedRagSetting()).not.toBeNull();
    });

    it("skips migration when settings already exist", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      // Pre-populate with an existing setting
      await manager.createRagSetting("Existing");

      const ragConfig: RagConfig = {
        enabled: true,
        embeddingModel: "nomic-embed-text",
        embeddingBaseUrl: "",
        targetFolders: [],
        excludePatterns: [],
        chunkSize: 1000,
        chunkOverlap: 200,
        topK: 5,
        minScore: 0.3,
      };

      const migrated = await manager.migrateFromRagConfig(ragConfig);

      expect(migrated).toBe(false);
      expect(manager.getRagSettingNames()).toEqual(["Existing"]);
    });
  });

  describe("createRagSetting", () => {
    it("creates a new setting with defaults", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("Test");

      expect(manager.getRagSettingNames()).toEqual(["Test"]);
      expect(manager.getRagSetting("Test")).toMatchObject({
        embeddingModel: "nomic-embed-text",
        chunkSize: 1000,
        topK: 5,
      });
      expect(emitter.emit).toHaveBeenCalledWith("workspace-state-loaded", manager.workspaceState);
    });

    it("creates a setting with custom overrides", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("Custom", { topK: 10, minScore: 0.5 });

      expect(manager.getRagSetting("Custom")).toMatchObject({
        topK: 10,
        minScore: 0.5,
        embeddingModel: "nomic-embed-text",
      });
    });

    it("throws on duplicate name", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("Test");

      await expect(manager.createRagSetting("Test")).rejects.toThrow(
        'RAG setting "Test" already exists',
      );
    });

    it("throws on sanitized name collision", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("test/name");

      await expect(manager.createRagSetting("test:name")).rejects.toThrow(
        /conflicts with existing setting/,
      );
    });
  });

  describe("deleteRagSetting", () => {
    it("deletes a setting and clears selection if selected", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("ToDelete");
      await manager.selectRagSetting("ToDelete");

      expect(manager.workspaceState.selectedRagSetting).toBe("ToDelete");

      await manager.deleteRagSetting("ToDelete");

      expect(manager.getRagSettingNames()).toEqual([]);
      expect(manager.workspaceState.selectedRagSetting).toBeNull();
    });

    it("does not affect selection when deleting a non-selected setting", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("A");
      await manager.createRagSetting("B");
      await manager.selectRagSetting("A");

      await manager.deleteRagSetting("B");

      expect(manager.workspaceState.selectedRagSetting).toBe("A");
      expect(manager.getRagSettingNames()).toEqual(["A"]);
    });

    it("removes deleted settings from source RAG bundles", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("A");
      await manager.createRagSetting("B");
      await manager.createRagSetting("Combined", { sourceRagSettings: ["A", "B"] });

      await manager.deleteRagSetting("B");

      expect(manager.getRagSetting("Combined")!.sourceRagSettings).toEqual(["A"]);
    });

    it("is a no-op for non-existent setting", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await expect(manager.deleteRagSetting("ghost")).resolves.toBeUndefined();
    });
  });

  describe("renameRagSetting", () => {
    it("renames a setting and updates selection", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("Old", { topK: 10 });
      await manager.selectRagSetting("Old");

      await manager.renameRagSetting("Old", "New");

      expect(manager.getRagSettingNames()).toEqual(["New"]);
      expect(manager.getRagSetting("New")).toMatchObject({ topK: 10 });
      expect(manager.getRagSetting("Old")).toBeNull();
      expect(manager.workspaceState.selectedRagSetting).toBe("New");
    });

    it("updates source RAG bundle references when renaming", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("A");
      await manager.createRagSetting("Combined", { sourceRagSettings: ["A"] });

      await manager.renameRagSetting("A", "Renamed");

      expect(manager.getRagSetting("Combined")!.sourceRagSettings).toEqual(["Renamed"]);
    });

    it("throws when old name does not exist", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await expect(manager.renameRagSetting("ghost", "New")).rejects.toThrow(
        'RAG setting "ghost" not found',
      );
    });

    it("throws when new name already exists", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("A");
      await manager.createRagSetting("B");

      await expect(manager.renameRagSetting("A", "B")).rejects.toThrow(
        'RAG setting "B" already exists',
      );
    });

    it("throws on sanitized collision during rename", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("a/b");
      await manager.createRagSetting("c");

      await expect(manager.renameRagSetting("c", "a:b")).rejects.toThrow(
        /conflicts with existing setting/,
      );
    });
  });

  describe("updateRagSetting", () => {
    it("updates fields on an existing setting", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("Test");
      await manager.updateRagSetting("Test", { topK: 20, minScore: 0.8 });

      expect(manager.getRagSetting("Test")).toMatchObject({ topK: 20, minScore: 0.8 });
    });

    it("filters self and missing source RAG settings", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("A");
      await manager.createRagSetting("Combined");
      await manager.updateRagSetting("Combined", { sourceRagSettings: ["A", "Combined", "missing"] });

      expect(manager.getRagSetting("Combined")!.sourceRagSettings).toEqual(["A"]);
    });

    it("throws when setting does not exist", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await expect(manager.updateRagSetting("ghost", { topK: 1 })).rejects.toThrow(
        'RAG setting "ghost" not found',
      );
    });
  });

  describe("selectRagSetting", () => {
    it("emits rag-setting-changed event", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.createRagSetting("Test");
      await manager.selectRagSetting("Test");

      expect(emitter.emit).toHaveBeenCalledWith("rag-setting-changed", "Test");
      expect(manager.workspaceState.selectedRagSetting).toBe("Test");
    });

    it("allows selecting null", async () => {
      const { app } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      await manager.selectRagSetting(null);

      expect(manager.workspaceState.selectedRagSetting).toBeNull();
      expect(emitter.emit).toHaveBeenCalledWith("rag-setting-changed", null);
    });
  });

  describe("loadWorkspaceState", () => {
    it("merges loaded data with defaults for new fields", async () => {
      const { app, exists, read } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      exists.mockResolvedValue(true);
      read.mockResolvedValue(JSON.stringify({
        selectedRagSetting: "Test",
        ragSettings: {
          Test: {
            embeddingModel: "custom-model",
            // Missing fields like externalIndexPath should be filled with defaults
          },
        },
      }));

      await manager.loadWorkspaceState();

      expect(manager.workspaceState.selectedRagSetting).toBe("Test");
      const setting = manager.getRagSetting("Test");
      expect(setting).not.toBeNull();
      expect(setting!.embeddingModel).toBe("custom-model");
      expect(setting!.externalIndexPath).toBe("");
      expect(setting!.sourceRagSettings).toEqual([]);
      expect(setting!.chunkSize).toBe(1000);
    });

    it("handles corrupted file gracefully", async () => {
      const { app, exists, read } = createAppMock();
      const emitter = createEmitter();
      const manager = new WorkspaceStateManager(app as never, emitter as never);

      exists.mockResolvedValue(true);
      read.mockResolvedValue("invalid json{{{");

      await manager.loadWorkspaceState();

      expect(manager.getRagSettingNames()).toEqual([]);
      expect(manager.workspaceState.selectedRagSetting).toBeNull();
    });
  });
});
