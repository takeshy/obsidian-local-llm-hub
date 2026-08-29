export interface ChatLinkFileRef {
  scope: "vault" | "absolute";
  path: string;
}

/** Extensions common enough in a Vault that a dotted first segment is still a path, not a host. */
const VAULT_FILE_EXT = /\.(md|canvas|base|pdf|txt|csv|json|ya?ml|png|jpe?g|gif|webp|svg|mp[34]|m4a|mov|webm)$/i;

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function normalizedPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** `file:///home/a` -> `/home/a`, `file:///C:/a` -> `C:/a`, `file://host/share` -> `//host/share`. */
function stripFileScheme(value: string): string {
  const rest = value.replace(/^file:\/\//i, "");
  if (/^\/[a-z]:[\\/]/i.test(rest)) return rest.slice(1);
  if (rest.startsWith("/")) return rest;
  return `//${rest}`;
}

function localTarget(href: string): string | null {
  const decoded = decodeHref(href).trim();
  if (!decoded || decoded.startsWith("#")) return null;
  if (/^file:\/\//i.test(decoded)) return stripFileScheme(decoded);
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) && !/^[a-z]:[\\/]/i.test(decoded)) return null;
  return decoded;
}

/** Obsidian renders bare hosts (`www.example.com/page`) as links too; those are not Vault notes. */
function looksLikeBareHost(target: string): boolean {
  return target.split("/")[0].includes(".") && !VAULT_FILE_EXT.test(target);
}

/** Windows drive paths and UNC shares are case-insensitive; posix roots are not. */
function isCaseInsensitiveRoot(root: string): boolean {
  return /^(?:[a-z]:\/|\/\/)/i.test(root);
}

function hasRootPrefix(target: string, root: string): boolean {
  const head = target.slice(0, root.length);
  return isCaseInsensitiveRoot(root) ? head.toLowerCase() === root.toLowerCase() : head === root;
}

/** Resolve a chat Markdown link as a Vault-relative or external local file. */
export function chatLinkFileRef(href: string, vaultBasePath: string): ChatLinkFileRef | null {
  const rawTarget = localTarget(href);
  if (!rawTarget) return null;

  // Keep the heading/block anchor for Vault links; a shell path can never use one.
  const hashAt = rawTarget.indexOf("#");
  const fragment = hashAt >= 0 ? rawTarget.slice(hashAt) : "";
  const target = normalizedPath((hashAt >= 0 ? rawTarget.slice(0, hashAt) : rawTarget).trim())
    .replace(/^\.\//, "");
  if (!target) return null;

  if (!/^(?:[a-z]:\/|\/)/i.test(target)) {
    return looksLikeBareHost(target) ? null : { scope: "vault", path: `${target}${fragment}` };
  }

  const root = normalizedPath(vaultBasePath);
  if (root && target.length > root.length && target[root.length] === "/" && hasRootPrefix(target, root)) {
    const relative = target.slice(root.length + 1).replace(/^\/+/, "");
    if (relative) return { scope: "vault", path: `${relative}${fragment}` };
  }
  return { scope: "absolute", path: target };
}
