import { describe, expect, it } from "vitest";
import { getVaultTools, isVaultToolAllowed } from "./tools";
import { executeToolCall } from "./toolExecutor";
import type { App } from "obsidian";

describe("Vault tool modes", () => {
  it("exposes only search and read tools in read-only mode", () => {
    expect(getVaultTools("readOnly").map(t => t.function.name).sort()).toEqual([
      "get_active_note", "list_folders", "list_notes", "read_note", "read_timeline", "search_notes",
    ]);
  });
  it("preserves other modes and external tool permissions", () => {
    expect(getVaultTools("none")).toEqual([]);
    expect(getVaultTools("noSearch").map(t => t.function.name)).not.toContain("search_notes");
    expect(getVaultTools("noSearch").map(t => t.function.name)).toContain("create_note");
    expect(isVaultToolAllowed("mcp__anki__addCard", "readOnly")).toBe(true);
    expect(isVaultToolAllowed("run_skill_workflow", "readOnly")).toBe(true);
  });
  it("rejects a hallucinated mutation before touching the vault", async () => {
    const result = await executeToolCall({ id: "1", name: "delete_note", args: { path: "test.md" } }, {
      app: {} as App, vaultToolMode: "readOnly",
    });
    expect(result.success).toBe(false);
    expect(result.result).toContain("disabled");
  });
});
