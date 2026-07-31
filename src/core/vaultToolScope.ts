import type { TFile } from "obsidian";

export const VAULT_TOOL_SCOPE_DENIED_MSG =
  "Access denied: LLM vault tools are limited to the configured allowed folders.";

export function normalizeVaultScopePath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed.startsWith("/") || /^[A-Z]:/i.test(trimmed) || trimmed.includes("\\")) {
    return null;
  }

  const segments = trimmed
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  return segments.join("/");
}

export function normalizeAllowedVaultFolders(folders: string[] | undefined): string[] {
  return (folders ?? [])
    .map((folder) => normalizeVaultScopePath(folder))
    .filter((folder): folder is string => !!folder);
}

export function hasVaultToolFolderRestrictions(folders: string[] | undefined): boolean {
  return !!folders && folders.length > 0;
}

export function isPathInAllowedVaultFolders(path: string, folders: string[] | undefined): boolean {
  if (!folders || folders.length === 0) return true;
  const normalizedFolders = normalizeAllowedVaultFolders(folders);
  if (normalizedFolders.length === 0) return false;

  const normalizedPath = normalizeVaultScopePath(path);
  if (!normalizedPath) return false;
  return normalizedFolders.some(
    (folder) => normalizedPath === folder || normalizedPath.startsWith(`${folder}/`),
  );
}

/**
 * Returns true for an allowed path or an ancestor needed to navigate to one.
 * Ancestors are for folder discovery only and must not be used to authorize
 * reading or writing vault contents.
 */
export function isPathNavigableForVaultTools(path: string, folders: string[] | undefined): boolean {
  if (!hasVaultToolFolderRestrictions(folders)) return true;
  const normalizedFolders = normalizeAllowedVaultFolders(folders);
  if (normalizedFolders.length === 0) return false;

  const normalizedPath = normalizeVaultScopePath(path);
  if (!normalizedPath) return false;
  return normalizedFolders.some(
    (folder) => normalizedPath === folder
      || normalizedPath.startsWith(`${folder}/`)
      || folder.startsWith(`${normalizedPath}/`),
  );
}

export function isFileAllowedForVaultTools(file: TFile, folders: string[] | undefined): boolean {
  return isPathInAllowedVaultFolders(file.path, folders);
}

export function assertVaultToolPathAllowed(path: string, folders: string[] | undefined): void {
  if (!isPathInAllowedVaultFolders(path, folders)) {
    throw new Error(VAULT_TOOL_SCOPE_DENIED_MSG);
  }
}

export function assertVaultToolFolderNavigable(path: string, folders: string[] | undefined): void {
  if (!isPathNavigableForVaultTools(path, folders)) {
    throw new Error(VAULT_TOOL_SCOPE_DENIED_MSG);
  }
}

export function assertVaultToolFileAllowed(file: TFile, folders: string[] | undefined): void {
  if (!isFileAllowedForVaultTools(file, folders)) {
    throw new Error(VAULT_TOOL_SCOPE_DENIED_MSG);
  }
}
