export interface ChatLinkFileRef {
  scope: "vault" | "absolute";
  path: string;
}

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

function localTarget(href: string): string | null {
  const decoded = decodeHref(href).trim();
  if (!decoded || decoded.startsWith("#")) return null;
  if (/^file:\/\//i.test(decoded)) return decoded.replace(/^file:\/\/\/?/i, "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) && !/^[a-z]:[\\/]/i.test(decoded)) return null;
  return decoded;
}

/** Resolve a chat Markdown link as a Vault-relative or external local file. */
export function chatLinkFileRef(href: string, vaultBasePath: string): ChatLinkFileRef | null {
  const rawTarget = localTarget(href);
  if (!rawTarget) return null;
  const target = normalizedPath(rawTarget.split("#")[0].trim());
  if (!target) return null;

  const absolute = /^(?:[a-z]:\/|\/|\/\/)/i.test(target);
  if (!absolute) return { scope: "vault", path: target.replace(/^\.\//, "") };

  const root = normalizedPath(vaultBasePath);
  const foldedTarget = target.toLocaleLowerCase();
  const foldedRoot = root.toLocaleLowerCase();
  if (root && (foldedTarget === foldedRoot || foldedTarget.startsWith(`${foldedRoot}/`))) {
    return { scope: "vault", path: target.slice(root.length).replace(/^\/+/, "") };
  }
  return { scope: "absolute", path: target };
}
