import { describe, expect, it } from "vitest";
import {
  isPathInAllowedVaultFolders,
  isPathNavigableForVaultTools,
  normalizeAllowedVaultFolders,
  normalizeVaultScopePath,
} from "./vaultToolScope";

describe("vault tool folder scope", () => {
  it("allows the whole vault when no folders are configured", () => {
    expect(isPathInAllowedVaultFolders("Private/Secret.md", [])).toBe(true);
  });

  it("allows only configured folders and descendants", () => {
    expect(isPathInAllowedVaultFolders("Public/Note.md", ["Public"])).toBe(true);
    expect(isPathInAllowedVaultFolders("Public/Nested/Note.md", ["Public"])).toBe(true);
    expect(isPathInAllowedVaultFolders("Publication/Note.md", ["Public"])).toBe(false);
    expect(isPathInAllowedVaultFolders("Private/Secret.md", ["Public"])).toBe(false);
  });

  it("preserves case so distinct folders cannot cross the boundary", () => {
    expect(isPathInAllowedVaultFolders("Public/Note.md", ["Public"])).toBe(true);
    expect(isPathInAllowedVaultFolders("public/Note.md", ["Public"])).toBe(false);
  });

  it("rejects absolute paths and traversal", () => {
    expect(normalizeVaultScopePath("/Public/Note.md")).toBeNull();
    expect(normalizeVaultScopePath("C:/Public/Note.md")).toBeNull();
    expect(normalizeVaultScopePath("Public/../Private/Secret.md")).toBeNull();
    expect(isPathInAllowedVaultFolders("Public/../Private/Secret.md", ["Public"])).toBe(false);
    expect(isPathInAllowedVaultFolders("Public/Note.md", ["../Private"])).toBe(false);
  });

  it("normalizes configured folder separators", () => {
    expect(normalizeAllowedVaultFolders([" Public/Docs/ ", "", "../Private"])).toEqual(["Public/Docs"]);
  });

  it("allows folder navigation through ancestors without granting file access", () => {
    const folders = ["Public/Docs"];

    expect(isPathNavigableForVaultTools("Public", folders)).toBe(true);
    expect(isPathNavigableForVaultTools("Public/Docs", folders)).toBe(true);
    expect(isPathNavigableForVaultTools("Public/Docs/Projects", folders)).toBe(true);
    expect(isPathNavigableForVaultTools("Public/Private", folders)).toBe(false);
    expect(isPathInAllowedVaultFolders("Public/Secret.md", folders)).toBe(false);
  });
});
