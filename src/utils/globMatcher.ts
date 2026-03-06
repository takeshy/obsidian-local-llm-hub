/**
 * Simple file pattern matching for workflow event triggers.
 *
 * Supports:
 * - `*` at start: suffix match (e.g., `*.md` matches `notes/test.md`)
 * - `*` at end: prefix match (e.g., `notes/*` matches `notes/test.md`)
 * - `*` on both sides or `**` or just `*`: match all files
 * - Otherwise: filePath includes pattern (substring match)
 */
export function matchFilePattern(pattern: string, filePath: string): boolean {
  if (!pattern || pattern === "*" || pattern === "**") {
    return true;
  }

  const startsWithWild = pattern.startsWith("*");
  const endsWithWild = pattern.endsWith("*");

  // Both sides wildcard: match all
  if (startsWithWild && endsWithWild) {
    // Extract the inner part (e.g., `*foo*` -> check if filePath contains `foo`)
    const inner = pattern.slice(1, -1);
    if (!inner) {
      return true;
    }
    return filePath.includes(inner);
  }

  // Suffix match: `*.md` -> filePath ends with `.md`
  if (startsWithWild) {
    const suffix = pattern.slice(1);
    return filePath.endsWith(suffix);
  }

  // Prefix match: `notes/*` -> filePath starts with `notes/`
  if (endsWithWild) {
    const prefix = pattern.slice(0, -1);
    return filePath.startsWith(prefix);
  }

  // Exact match or substring match
  return filePath === pattern || filePath.includes(pattern);
}
