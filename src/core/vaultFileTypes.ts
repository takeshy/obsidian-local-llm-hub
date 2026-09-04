import { TFile, type App } from "obsidian";

const TEXT_VAULT_EXTENSIONS = new Set([
  "base",
  "canvas",
  "css",
  "csv",
  "dashboard",
  "html",
  "js",
  "json",
  "md",
  "svg",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

export function isVaultTextFile(file: TFile): boolean {
  return TEXT_VAULT_EXTENSIONS.has(file.extension.toLowerCase());
}

export function getVaultTextFiles(app: App): TFile[] {
  return app.vault.getFiles().filter(isVaultTextFile);
}

/** Files read_note can return: text files plus PDFs (attached or text-extracted). */
export function isVaultReadableFile(file: TFile): boolean {
  return isVaultTextFile(file) || file.extension.toLowerCase() === "pdf";
}

export function getVaultReadableFiles(app: App): TFile[] {
  return app.vault.getFiles().filter(isVaultReadableFile);
}

export function hasExplicitExtension(filePath: string): boolean {
  const normalized = filePath.trim().replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  const name = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const lastDot = name.lastIndexOf(".");
  return lastDot > 0 && lastDot < name.length - 1;
}

export function ensureMarkdownExtensionIfMissing(filePath: string): string {
  return hasExplicitExtension(filePath) ? filePath : `${filePath}.md`;
}
