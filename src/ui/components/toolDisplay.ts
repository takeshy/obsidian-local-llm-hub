export function getReadNotePageRange(toolName: string, args: Record<string, unknown>): string | null {
  if (toolName !== "read_note") return null;
  const startPage = typeof args.startPage === "number" ? args.startPage : undefined;
  const endPage = typeof args.endPage === "number" ? args.endPage : undefined;
  if (startPage === undefined && endPage === undefined) return null;
  return `pages ${startPage ?? 1}-${endPage ?? "end"}`;
}
