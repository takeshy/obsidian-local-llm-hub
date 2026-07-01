import type { NodeFs } from "./nodeCompat";

export function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\");
}

export function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

export function getNodeFs(): NodeFs | null {
  const runtimeWindow = window as Window & { require?: (id: string) => unknown };
  const requireFn = runtimeWindow.require;
  if (!requireFn) return null;
  try {
    return requireFn("fs") as NodeFs;
  } catch {
    return null;
  }
}
