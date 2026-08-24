import { describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "obsidian";
import { ensureAdapterFolder } from "./vaultAdapter";

describe("ensureAdapterFolder", () => {
  it("creates nested folders through the adapter", async () => {
    const existing = new Set<string>();
    const mkdir = vi.fn(async (path: string) => { existing.add(path); });
    const adapter = {
      exists: async (path: string) => existing.has(path),
      mkdir,
    } as unknown as DataAdapter;

    await ensureAdapterFolder(adapter, ".LocalLlmHub/chats");

    expect(mkdir.mock.calls).toEqual([[".LocalLlmHub"], [".LocalLlmHub/chats"]]);
  });

  it("accepts a concurrent folder creation", async () => {
    const existing = new Set<string>();
    const adapter = {
      exists: async (path: string) => existing.has(path),
      mkdir: async (path: string) => {
        existing.add(path);
        throw new Error("Folder already exists.");
      },
    } as unknown as DataAdapter;

    await expect(ensureAdapterFolder(adapter, "chats")).resolves.toBeUndefined();
  });
});
