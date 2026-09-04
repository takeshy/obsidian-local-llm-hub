import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import {
  ensureMarkdownExtensionIfMissing,
  hasExplicitExtension,
  isVaultTextFile,
} from "./vaultFileTypes";

function makeFile(path: string): TFile {
  const file = new TFile();
  const name = path.split("/").pop() ?? path;
  const lastDot = name.lastIndexOf(".");
  file.path = path;
  file.name = name;
  file.basename = lastDot > 0 ? name.slice(0, lastDot) : name;
  file.extension = lastDot > 0 ? name.slice(lastDot + 1) : "";
  return file;
}

describe("vaultFileTypes", () => {
  it("recognizes supported text-based vault files", () => {
    expect(isVaultTextFile(makeFile("Board.canvas"))).toBe(true);
    expect(isVaultTextFile(makeFile("View.base"))).toBe(true);
    expect(isVaultTextFile(makeFile("Workspace.dashboard"))).toBe(true);
    expect(isVaultTextFile(makeFile("Config.json"))).toBe(true);
    expect(isVaultTextFile(makeFile("Image.png"))).toBe(false);
  });

  it("detects explicit extensions", () => {
    expect(hasExplicitExtension("Daily")).toBe(false);
    expect(hasExplicitExtension("Folder/Board.canvas")).toBe(true);
  });

  it("adds markdown extension only when missing", () => {
    expect(ensureMarkdownExtensionIfMissing("Daily")).toBe("Daily.md");
    expect(ensureMarkdownExtensionIfMissing("Folder/Board.canvas")).toBe("Folder/Board.canvas");
  });
});
