// Diff reconstruction utilities for edit history.

interface ParsedHunk {
  startIdx: number;
  searchLines: string[];
  replaceLines: string[];
}

function parseHunks(diffStr: string): ParsedHunk[] {
  const diffLines = diffStr.split("\n");
  const hunks: ParsedHunk[] = [];
  let i = 0;

  while (i < diffLines.length) {
    const line = diffLines[i];
    const hunkMatch = line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@/);

    if (hunkMatch) {
      const startIdx = parseInt(hunkMatch[1], 10) - 1;
      const searchLines: string[] = [];
      const replaceLines: string[] = [];

      i++;
      while (i < diffLines.length && !diffLines[i].startsWith("@@")) {
        const hunkLine = diffLines[i];
        if (hunkLine.startsWith("-")) {
          searchLines.push(hunkLine.substring(1));
        } else if (hunkLine.startsWith("+")) {
          replaceLines.push(hunkLine.substring(1));
        } else if (hunkLine.startsWith(" ")) {
          searchLines.push(hunkLine.substring(1));
          replaceLines.push(hunkLine.substring(1));
        }
        i++;
      }

      hunks.push({ startIdx, searchLines, replaceLines });
    } else {
      i++;
    }
  }

  return hunks;
}

interface ApplyHunksResult {
  content: string;
  unmatchedHunks: number;
}

function applyHunks(content: string, hunks: ParsedHunk[]): ApplyHunksResult {
  const lines = content.split("\n");
  const reversed = [...hunks].reverse();
  let unmatchedHunks = 0;

  for (const hunk of reversed) {
    let startIdx = hunk.startIdx;
    let matched = false;

    if (hunk.searchLines.length === 0) {
      matched = true;
    } else {
      const lo = Math.max(0, startIdx - 5);
      const hi = Math.min(lines.length - hunk.searchLines.length, startIdx + 5);
      for (let j = lo; j <= hi; j++) {
        if (j + hunk.searchLines.length > lines.length) continue;
        let isMatch = true;
        for (let k = 0; k < hunk.searchLines.length; k++) {
          if (lines[j + k] !== hunk.searchLines[k]) {
            isMatch = false;
            break;
          }
        }
        if (isMatch) {
          startIdx = j;
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      lines.splice(startIdx, hunk.searchLines.length, ...hunk.replaceLines);
    } else {
      unmatchedHunks++;
      console.warn("[diffUtils] hunk did not match at expected position", hunk.startIdx, hunk.searchLines.slice(0, 3));
    }
  }

  return { content: lines.join("\n"), unmatchedHunks };
}

export function applyDiff(content: string, diff: string, options?: { strict?: boolean }): string {
  const hunks = parseHunks(diff);
  const result = applyHunks(content, hunks);
  if (options?.strict && result.unmatchedHunks > 0) {
    throw new Error(`${result.unmatchedHunks} diff hunk(s) failed to match`);
  }
  return result.content;
}

export function reverseApplyDiff(content: string, diffStr: string, options?: { strict?: boolean }): string {
  const lines = diffStr.split("\n");
  const reversed: string[] = [];

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)$/);
    if (hunkMatch) {
      const oldPart = hunkMatch[4] ? `${hunkMatch[3]},${hunkMatch[4]}` : hunkMatch[3];
      const newPart = hunkMatch[2] ? `${hunkMatch[1]},${hunkMatch[2]}` : hunkMatch[1];
      reversed.push(`@@ -${oldPart} +${newPart} @@${hunkMatch[5]}`);
    } else if (line.startsWith("+")) {
      reversed.push("-" + line.slice(1));
    } else if (line.startsWith("-")) {
      reversed.push("+" + line.slice(1));
    } else {
      reversed.push(line);
    }
  }

  const reversedStr = reversed.join("\n");
  const hunks = parseHunks(reversedStr);
  const result = applyHunks(content, hunks);
  if (options?.strict && result.unmatchedHunks > 0) {
    throw new Error(`${result.unmatchedHunks} diff hunk(s) failed to match`);
  }
  return result.content;
}

export type DiffWithOrigin = { diff: string; origin: "local" | "remote" };

export function reconstructContent(
  currentContent: string,
  entriesToReverse: DiffWithOrigin[]
): string {
  let content = currentContent;
  for (const entry of entriesToReverse) {
    if (entry.origin === "remote") {
      content = reverseApplyDiff(content, entry.diff);
    } else {
      content = applyDiff(content, entry.diff);
    }
  }
  return content;
}
