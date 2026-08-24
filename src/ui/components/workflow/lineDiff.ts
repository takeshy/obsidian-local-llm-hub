export type DiffLineType = "unchanged" | "added" | "removed";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

/** Calculate a line-based diff between two strings using an LCS table. */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      lcs[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? lcs[i - 1][j - 1] + 1
        : Math.max(lcs[i - 1][j], lcs[i][j - 1]);
    }
  }

  let i = m;
  let j = n;
  const stack: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: "unchanged", content: oldLines[i - 1], oldLineNum: i, newLineNum: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      stack.push({ type: "added", content: newLines[j - 1], newLineNum: j });
      j--;
    } else {
      stack.push({ type: "removed", content: oldLines[i - 1], oldLineNum: i });
      i--;
    }
  }

  while (stack.length > 0) result.push(stack.pop()!);
  return result;
}
