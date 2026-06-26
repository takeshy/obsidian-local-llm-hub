# RAG Toggle, Citation Locations, and Chunking Strategies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-level RAG enable/disable checkbox, surface per-chunk citation locations (heading/page/offset) with click-to-scroll, and add sentence/block chunking strategies to the Local LLM Hub Obsidian plugin.

**Architecture:** Three independent-but-overlapping changes share the `RagSetting`/`Message` type layer. (1) Chunking strategies live entirely in `src/core/ragStore.ts` plus the `RagIndex` storage shape, dispatched by a `chunkContent()` selector that replaces direct `chunkText()` calls in `sync()`/`syncFile()`. (2) Citation locations extend `RagSearchResult` with `heading`/`startOffset` computed at search time (topK is small), and a new `RagCitation[]` flows from `Chat.tsx` → `MessageBubble.tsx` → `chatHistory.ts`. (3) The RAG toggle is pure React state in `Chat.tsx` gated around the existing search block, surfaced via a checkbox in `InputArea.tsx`.

**Tech Stack:** TypeScript, React 18 (function components + hooks), Obsidian plugin API, Vitest, esbuild.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/types/index.ts` | Core shared types (`ChunkStrategy`, `RagCitation`, `RagSetting.chunkStrategy`, `Message.ragCitations`) | Modify |
| `src/core/ragStorage.ts` | On-disk index shape (`RagIndex.chunkStrategy`) | Modify |
| `src/core/ragStore.ts` | Chunking functions, rebuild trigger, `RagSearchResult` extension, heading computation at search time | Modify |
| `src/core/ragStore.test.ts` | Unit tests for new chunkers + dispatcher | Modify |
| `src/ui/components/Chat.tsx` | `ragEnabled` state, conditional search, citation building, LLM context injection | Modify |
| `src/ui/components/InputArea.tsx` | RAG checkbox before the `<select>` | Modify |
| `src/ui/components/MessageBubble.tsx` | Rich citation chips + `scrollEditorToOffset` click handler | Modify |
| `src/ui/components/chat/chatHistory.ts` | Serialize/parse `ragCitations` | Modify |
| `src/ui/settings/ragSettings.ts` | `chunkStrategy` dropdown above chunk-size | Modify |
| `src/i18n/en.ts`, `src/i18n/ja.ts` | New strings (toggle, citations, chunk strategy) | Modify |
| `styles.css` | Checkbox layout + citation chip styles | Modify |

**Conventions in this codebase (follow exactly):**
- i18n keys are flat dotted strings; `en.ts` is the source of truth typed via `TranslationKey = keyof typeof en`; `ja.ts` is a plain `Record<string, string>`.
- `RagSetting` fields default in `DEFAULT_RAG_SETTING`; missing fields from old persisted data are read with `??`/`?? "fixed"` fallbacks (see existing `minScore ?? 0` pattern).
- Chunkers return `{ text: string; startOffset: number }[]` — every new chunker must match this signature so the dispatcher and `sync()` embedding-prefix logic stay unchanged.
- `findNearestHeading(text, offset)` is already exported from `ragStore.ts` and returns `""` when no heading precedes the offset.
- Tests run via `npx vitest run` (config in `vitest.config.ts`); the existing `ragStore.test.ts` imports pure functions directly from `./ragStore`.

---

## Task 1: Add core types (`ChunkStrategy`, `RagCitation`, extend `RagSetting`/`Message`)

**Files:**
- Modify: `src/types/index.ts:23-50` (RagSetting + DEFAULT_RAG_SETTING), `src/types/index.ts:121-138` (Message)

- [ ] **Step 1: Add `ChunkStrategy` type and `RagCitation` interface**

Edit `src/types/index.ts`. Immediately above the `RagSetting` interface (line 23), insert:

```ts
// RAG chunking strategy
export type ChunkStrategy = "fixed" | "sentence" | "block";

// One cited RAG chunk with its location in the source document
export interface RagCitation {
  filePath: string;
  heading?: string;      // nearest Markdown heading ("" when none)
  startOffset: number;   // chunk start offset in the source document
  snippet: string;       // first ~120 chars of the chunk (for tooltip/preview)
  pageLabel?: string;    // PDF page range, e.g. "pages 2-5 of 24"
}
```

- [ ] **Step 2: Add `chunkStrategy` to `RagSetting` and `DEFAULT_RAG_SETTING`**

In `src/types/index.ts`, inside the `RagSetting` interface, add a new field after `chunkOverlap` (line 28):

```ts
  chunkStrategy: ChunkStrategy;   // chunking strategy (default: "fixed")
```

In `DEFAULT_RAG_SETTING` (line 38), add after `chunkOverlap: 200,`:

```ts
  chunkStrategy: "fixed",
```

- [ ] **Step 3: Add `ragCitations` to `Message`**

In `src/types/index.ts`, inside the `Message` interface, add after the `ragSources?: string[];` line (line 130):

```ts
  ragCitations?: RagCitation[];   // per-chunk citation locations (new chats)
```

Leave the existing `ragSources?: string[];` field untouched (backward compatibility for saved histories).

- [ ] **Step 4: Verify type-check passes**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: No new errors. (Pre-existing errors, if any, are unchanged.)

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(rag): add ChunkStrategy, RagCitation, and ragCitations types"
```

---

## Task 2: Implement `chunkBySentence` (TDD)

**Files:**
- Modify: `src/core/ragStore.test.ts` (append tests)
- Modify: `src/core/ragStore.ts:981-1025` (add `chunkBySentence` after `chunkText`)

- [ ] **Step 1: Write the failing tests**

Append to `src/core/ragStore.test.ts`. Update the import block at the top (line 2-9) to also import `chunkBySentence`:

```ts
import {
  chunkText,
  chunkBySentence,
  cosineSimilarity,
  simpleChecksum,
  simpleChecksumBytes,
  findNearestHeading,
  parseExternalIndexPaths,
} from "./ragStore";
```

Append a new `describe` block at the end of the file:

```ts
// --- chunkBySentence ---

describe("chunkBySentence", () => {
  it("returns empty array for empty text", () => {
    expect(chunkBySentence("", 1000, 200)).toHaveLength(0);
  });

  it("returns a single chunk when text fits chunkSize", () => {
    const text = "Hello world. Foo bar.";
    const result = chunkBySentence(text, 1000, 200);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Hello world. Foo bar.");
    expect(result[0].startOffset).toBe(0);
  });

  it("splits on English period followed by whitespace", () => {
    const text = "First sentence. Second sentence. Third sentence.";
    const result = chunkBySentence(text, 25, 0);
    expect(result.length).toBeGreaterThan(1);
    // Each emitted chunk (except possibly the last) should not exceed chunkSize
    for (const chunk of result) {
      expect(chunk.text.length).toBeLessThanOrEqual(25);
    }
    // startOffset values must be valid indices into the original text
    for (const chunk of result) {
      expect(chunk.startOffset).toBeGreaterThanOrEqual(0);
      expect(chunk.startOffset).toBeLessThan(text.length);
      expect(text.startsWith(chunk.text.trimStart(), chunk.startOffset)).toBe(true);
    }
  });

  it("splits on Chinese full-width period 。", () => {
    const text = "这是第一句话。这是第二句话。这是第三句话。";
    const result = chunkBySentence(text, 12, 0);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.text.length).toBeLessThanOrEqual(12);
    }
  });

  it("groups multiple sentences into one chunk until chunkSize is exceeded", () => {
    const text = "A. B. C. D. E. F. G. H.";
    const result = chunkBySentence(text, 8, 0);
    // Each chunk holds as many whole sentences as fit within 8 chars
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.text.length).toBeLessThanOrEqual(8);
    }
  });

  it("carries overlap into the next chunk", () => {
    const text = "Sentence one here. Sentence two here. Sentence three here. Sentence four here.";
    const result = chunkBySentence(text, 25, 10);
    expect(result.length).toBeGreaterThan(1);
    // With overlap, a later chunk should start before the previous chunk ended
    expect(result[1].startOffset).toBeLessThan(result[0].startOffset + result[0].text.length);
  });

  it("falls back to a single chunk when no terminators present", () => {
    const text = "no terminators here just plain words running on and on";
    const result = chunkBySentence(text, 30, 5);
    // No sentence boundary -> one chunk (length may exceed chunkSize since no split point)
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(text);
    expect(result[0].startOffset).toBe(0);
  });

  it("records correct startOffset for each chunk", () => {
    const text = "One. Two. Three. Four. Five.";
    const result = chunkBySentence(text, 12, 0);
    // The concatenation of slice(text, startOffset, startOffset + text.length)
    // must reproduce the chunk text (trimmed-end tolerance handled by checking startsWith)
    for (const chunk of result) {
      expect(text.startsWith(chunk.text, chunk.startOffset)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/ragStore.test.ts -t "chunkBySentence"`
Expected: FAIL — `chunkBySentence is not a function` (or import error).

- [ ] **Step 3: Implement `chunkBySentence`**

In `src/core/ragStore.ts`, immediately after the closing brace of `chunkText` (after line 1025), add:

```ts
/**
 * Split text into chunks on sentence terminators (English ". " and Chinese "。"),
 * accumulating sentences until adding the next would exceed chunkSize.
 * Falls back to a single chunk when no terminators are present.
 * Each chunk records its startOffset in the original text.
 */
export function chunkBySentence(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): { text: string; startOffset: number }[] {
  const chunks: { text: string; startOffset: number }[] = [];
  if (text.length === 0) return chunks;

  // Find all sentence boundary end indices (index just past the terminator).
  const terminatorPattern = /[。\.]\s*/g;
  const boundaries: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = terminatorPattern.exec(text)) !== null) {
    boundaries.push(match.index + match[0].length);
  }

  // No terminators -> single chunk (even if it exceeds chunkSize)
  if (boundaries.length === 0) {
    const trimmed = text.trim();
    if (trimmed) chunks.push({ text: trimmed, startOffset: 0 });
    return chunks;
  }

  // Build sentence spans [start, end) using boundaries.
  const spans: { start: number; end: number }[] = [];
  let prevEnd = 0;
  for (const end of boundaries) {
    spans.push({ start: prevEnd, end });
    prevEnd = end;
  }
  // Trailing text after the last terminator
  if (prevEnd < text.length) {
    spans.push({ start: prevEnd, end: text.length });
  }

  let i = 0;
  while (i < spans.length) {
    let accStart = spans[i].start;
    let accEnd = spans[i].end;
    // Greedily accumulate subsequent sentences while within budget
    let j = i + 1;
    while (j < spans.length && (accEnd - accStart) + (spans[j].end - spans[j].start) <= chunkSize) {
      accEnd = spans[j].end;
      j++;
    }

    const chunkStr = text.slice(accStart, accEnd).trim();
    if (chunkStr) {
      chunks.push({ text: chunkStr, startOffset: accStart });
    }

    if (j >= spans.length) break;

    // Overlap: step back into the accumulated span by chunkOverlap chars
    // (but never past accStart; if overlap >= span length, advance by one span).
    const advanceEnd = accEnd;
    let nextStart = advanceEnd - chunkOverlap;
    if (nextStart <= accStart) {
      nextStart = accStart; // ensures forward progress; loop will move via span index
    }
    // Find the first span whose start is >= nextStart (and > accStart to guarantee progress)
    let k = i + 1;
    while (k < spans.length && spans[k].start < nextStart) {
      k++;
    }
    if (k <= i + 1) {
      k = i + 1; // guarantee forward progress
    }
    i = k;
  }

  return chunks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/ragStore.test.ts -t "chunkBySentence"`
Expected: PASS — all 8 `chunkBySentence` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/ragStore.ts src/core/ragStore.test.ts
git commit -m "feat(rag): add chunkBySentence chunking strategy"
```

---

## Task 3: Implement `chunkByBlock` (TDD)

**Files:**
- Modify: `src/core/ragStore.test.ts` (append tests)
- Modify: `src/core/ragStore.ts` (add `chunkByBlock` after `chunkBySentence`)

- [ ] **Step 1: Write the failing tests**

Update the import block in `src/core/ragStore.test.ts` to also import `chunkByBlock`:

```ts
import {
  chunkText,
  chunkBySentence,
  chunkByBlock,
  cosineSimilarity,
  simpleChecksum,
  simpleChecksumBytes,
  findNearestHeading,
  parseExternalIndexPaths,
} from "./ragStore";
```

Append a new `describe` block at the end of the file:

```ts
// --- chunkByBlock ---

describe("chunkByBlock", () => {
  it("returns empty array for empty text", () => {
    expect(chunkByBlock("", 1000, 200)).toHaveLength(0);
  });

  it("returns a single chunk when no blank-line breaks", () => {
    const text = "line one\nline two\nline three";
    const result = chunkByBlock(text, 1000, 200);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(text);
    expect(result[0].startOffset).toBe(0);
  });

  it("splits into separate chunks on blank lines", () => {
    const text = "block one line\nblock one line\n\nblock two line\n\nblock three";
    const result = chunkByBlock(text, 1000, 0);
    expect(result.length).toBe(3);
    expect(result[0].text).toContain("block one");
    expect(result[1].text).toContain("block two");
    expect(result[2].text).toContain("block three");
  });

  it("merges consecutive small blocks until chunkSize is exceeded", () => {
    const blockA = "aaaa";
    const blockB = "bbbb";
    const blockC = "cccc";
    const text = `${blockA}\n\n${blockB}\n\n${blockC}`;
    // chunkSize large enough to hold all three -> single merged chunk
    const result = chunkByBlock(text, 100, 0);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain("aaaa");
    expect(result[0].text).toContain("bbbb");
    expect(result[0].text).toContain("cccc");
  });

  it("re-splits a large block using sentence chunking", () => {
    const big = "Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.";
    const text = `${big}\n\nsmall block`;
    const result = chunkByBlock(text, 30, 0);
    // The big block exceeds 30 chars and has sentence terminators -> re-split.
    // Expect more than 2 chunks (big block split into multiple + small block).
    expect(result.length).toBeGreaterThan(2);
    for (const chunk of result) {
      expect(chunk.text.length).toBeLessThanOrEqual(30);
    }
  });

  it("re-splits a large block with no terminators using fixed chunking", () => {
    const big = "x".repeat(80); // no terminators, exceeds chunkSize
    const text = `${big}\n\ntiny`;
    const result = chunkByBlock(text, 30, 0);
    expect(result.length).toBeGreaterThan(1);
    // Sub-chunks of the large block should each be <= 30 chars
    for (const chunk of result) {
      if (chunk.text !== "tiny") {
        expect(chunk.text.length).toBeLessThanOrEqual(30);
      }
    }
  });

  it("records correct startOffset for each chunk", () => {
    const text = "alpha\n\nbeta\n\ngamma";
    const result = chunkByBlock(text, 1000, 0);
    expect(result).toHaveLength(3);
    for (const chunk of result) {
      // The chunk text (trimmed) should be findable at its startOffset
      expect(text.startsWith(chunk.text, chunk.startOffset)).toBe(true);
    }
    // Offsets should be strictly increasing
    expect(result[0].startOffset).toBeLessThan(result[1].startOffset);
    expect(result[1].startOffset).toBeLessThan(result[2].startOffset);
  });

  it("never merges content across a blank-line boundary beyond chunkSize", () => {
    const text = "block-A\n\nblock-B";
    // chunkSize too small to hold both -> they stay separate
    const result = chunkByBlock(text, 5, 0);
    expect(result.length).toBe(2);
    expect(result[0].text).toBe("block-A");
    expect(result[1].text).toBe("block-B");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/ragStore.test.ts -t "chunkByBlock"`
Expected: FAIL — `chunkByBlock is not a function`.

- [ ] **Step 3: Implement `chunkByBlock`**

In `src/core/ragStore.ts`, immediately after `chunkBySentence`, add:

```ts
/**
 * Split text into chunks by Obsidian blocks (text wrapped by blank lines).
 * - Small blocks are greedily merged into one chunk until chunkSize is exceeded.
 *   Only whole blocks are concatenated (joined by "\n\n"); a block is never split
 *   to merge with a different logical block's interior.
 * - A large block (length > chunkSize) is re-chunked with chunkBySentence,
 *   falling back to chunkText when the block has no sentence terminators.
 *   Sub-chunks inherit offsets relative to the original text.
 * Each chunk records its startOffset in the original text.
 */
export function chunkByBlock(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): { text: string; startOffset: number }[] {
  const chunks: { text: string; startOffset: number }[] = [];
  if (text.length === 0) return chunks;

  // Split on blank lines, tracking each block's startOffset.
  const blockPattern = /\n\s*\n/g;
  const blocks: { text: string; startOffset: number }[] = [];
  let prevEnd = 0;
  let match: RegExpExecArray | null;
  const indices: number[] = [];
  while ((match = blockPattern.exec(text)) !== null) {
    indices.push(match.index);
  }
  for (const splitIndex of indices) {
    const blockText = text.slice(prevEnd, splitIndex);
    if (blockText.length > 0) blocks.push({ text: blockText, startOffset: prevEnd });
    // Advance past the blank-line separator
    const sepMatch = /\n\s*\n/.exec(text.slice(splitIndex));
    prevEnd = splitIndex + (sepMatch ? sepMatch[0].length : 0);
  }
  // Trailing block
  if (prevEnd < text.length) {
    blocks.push({ text: text.slice(prevEnd), startOffset: prevEnd });
  }

  if (blocks.length === 0) return chunks;

  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    const blockTrimmed = block.text.trim();

    if (blockTrimmed.length === 0) {
      i++;
      continue;
    }

    // Large block: re-chunk it (sentence first, then fixed fallback)
    if (blockTrimmed.length > chunkSize) {
      const hasTerminator = /[。\.]\s/.test(block.text) || /[。]/.test(block.text);
      const sub = hasTerminator
        ? chunkBySentence(block.text, chunkSize, chunkOverlap)
        : chunkText(block.text, chunkSize, chunkOverlap);
      for (const s of sub) {
        const sTrimmed = s.text.trim();
        if (sTrimmed) {
          chunks.push({ text: sTrimmed, startOffset: block.startOffset + s.startOffset });
        }
      }
      i++;
      continue;
    }

    // Small block: greedily merge consecutive blocks within budget
    let accText = block.text;
    let accStart = block.startOffset;
    let j = i + 1;
    while (j < blocks.length) {
      const next = blocks[j];
      const nextTrimmed = next.text.trim();
      if (nextTrimmed.length === 0) { j++; continue; }
      // Large block encountered while accumulating -> stop merging
      if (nextTrimmed.length > chunkSize) break;
      const candidate = accText + "\n\n" + next.text;
      if (candidate.length > chunkSize) break;
      accText = candidate;
      j++;
    }

    const accTrimmed = accText.trim();
    if (accTrimmed) {
      chunks.push({ text: accTrimmed, startOffset: accStart });
    }
    i = j;
  }

  return chunks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/ragStore.test.ts -t "chunkByBlock"`
Expected: PASS — all 8 `chunkByBlock` tests pass.

- [ ] **Step 5: Run the full ragStore test suite to check no regressions**

Run: `npx vitest run src/core/ragStore.test.ts`
Expected: PASS — all existing + new tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/ragStore.ts src/core/ragStore.test.ts
git commit -m "feat(rag): add chunkByBlock chunking strategy"
```

---

## Task 4: Add `chunkContent` dispatcher and wire `sync()`/`syncFile()` + rebuild trigger

**Files:**
- Modify: `src/core/ragStorage.ts:18-25` (`RagIndex`)
- Modify: `src/core/ragStore.ts` (import `ChunkStrategy`, dispatcher, `sync` rebuild check, `syncFile`, `mergeLoadedIndexes`, index building)

- [ ] **Step 1: Add `chunkStrategy` to `RagIndex`**

In `src/core/ragStorage.ts`, update the `RagIndex` interface (lines 18-25) to add an optional `chunkStrategy` field:

```ts
export interface RagIndex {
  meta: ChunkMeta[];
  dimension: number;
  fileChecksums: Record<string, string>; // filePath -> checksum
  embeddingFormatVersion?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  chunkStrategy?: ChunkStrategy;
}
```

Add the import at the top of `src/core/ragStorage.ts` (after line 8 `import { WORKSPACE_FOLDER } from "../types";`):

```ts
import type { ChunkStrategy } from "../types";
```

- [ ] **Step 2: Import `ChunkStrategy` in `ragStore.ts`**

In `src/core/ragStore.ts`, update the type import on line 8:

```ts
import type { LocalLlmConfig, RagSetting, ChunkStrategy } from "../types";
```

- [ ] **Step 3: Add the `chunkContent` dispatcher**

In `src/core/ragStore.ts`, immediately after `chunkByBlock` (added in Task 3), add:

```ts
/**
 * Dispatch chunking based on the RagSetting's chunkStrategy.
 * Falls back to the fixed `chunkText` strategy for unknown/missing values.
 */
export function chunkContent(
  content: string,
  ragSetting: RagSetting,
): { text: string; startOffset: number }[] {
  switch (ragSetting.chunkStrategy ?? "fixed") {
    case "sentence":
      return chunkBySentence(content, ragSetting.chunkSize, ragSetting.chunkOverlap);
    case "block":
      return chunkByBlock(content, ragSetting.chunkSize, ragSetting.chunkOverlap);
    default:
      return chunkText(content, ragSetting.chunkSize, ragSetting.chunkOverlap);
  }
}
```

- [ ] **Step 4: Write a failing dispatcher test**

Append to `src/core/ragStore.test.ts`. Update the import to also bring in `chunkContent`:

```ts
import {
  chunkText,
  chunkBySentence,
  chunkByBlock,
  chunkContent,
  cosineSimilarity,
  simpleChecksum,
  simpleChecksumBytes,
  findNearestHeading,
  parseExternalIndexPaths,
} from "./ragStore";
import { DEFAULT_RAG_SETTING } from "../types";
```

Append:

```ts
// --- chunkContent dispatcher ---

describe("chunkContent", () => {
  it("uses chunkText for the fixed strategy (default)", () => {
    const text = "a".repeat(2500);
    const setting = { ...DEFAULT_RAG_SETTING, chunkStrategy: "fixed" as const, chunkSize: 1000, chunkOverlap: 200 };
    const viaDispatcher = chunkContent(text, setting);
    const direct = chunkText(text, 1000, 200);
    expect(viaDispatcher).toEqual(direct);
  });

  it("uses chunkBySentence for the sentence strategy", () => {
    const text = "One. Two. Three. Four. Five.";
    const setting = { ...DEFAULT_RAG_SETTING, chunkStrategy: "sentence" as const, chunkSize: 12, chunkOverlap: 0 };
    const viaDispatcher = chunkContent(text, setting);
    const direct = chunkBySentence(text, 12, 0);
    expect(viaDispatcher).toEqual(direct);
  });

  it("uses chunkByBlock for the block strategy", () => {
    const text = "alpha\n\nbeta\n\ngamma";
    const setting = { ...DEFAULT_RAG_SETTING, chunkStrategy: "block" as const, chunkSize: 5, chunkOverlap: 0 };
    const viaDispatcher = chunkContent(text, setting);
    const direct = chunkByBlock(text, 5, 0);
    expect(viaDispatcher).toEqual(direct);
  });

  it("falls back to fixed when chunkStrategy is undefined", () => {
    const text = "a".repeat(2500);
    const setting = { ...DEFAULT_RAG_SETTING, chunkStrategy: undefined, chunkSize: 1000, chunkOverlap: 200 };
    const viaDispatcher = chunkContent(text, setting);
    const direct = chunkText(text, 1000, 200);
    expect(viaDispatcher).toEqual(direct);
  });
});
```

- [ ] **Step 5: Run dispatcher tests**

Run: `npx vitest run src/core/ragStore.test.ts -t "chunkContent"`
Expected: PASS.

- [ ] **Step 6: Wire `sync()` to use `chunkContent` + extend rebuild check**

In `src/core/ragStore.ts`, update the rebuild check in `sync()` (lines 243-246). Replace:

```ts
    const needsFullRebuild = !incompatible && index !== null && (
      index.chunkSize !== ragSetting.chunkSize ||
      index.chunkOverlap !== ragSetting.chunkOverlap
    );
```

with:

```ts
    const needsFullRebuild = !incompatible && index !== null && (
      index.chunkSize !== ragSetting.chunkSize ||
      index.chunkOverlap !== ragSetting.chunkOverlap ||
      index.chunkStrategy !== (ragSetting.chunkStrategy ?? "fixed")
    );
```

Then in the `sync()` chunking loop (line 378), replace:

```ts
        const chunks = chunkText(content, ragSetting.chunkSize, ragSetting.chunkOverlap);
```

with:

```ts
        const chunks = chunkContent(content, ragSetting);
```

Then update the `newIndex` object built in `sync()` (around line 450-457). Replace:

```ts
    const newIndex: RagIndex = {
      meta: allMeta,
      dimension,
      fileChecksums: newChecksums,
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
      chunkSize: ragSetting.chunkSize,
      chunkOverlap: ragSetting.chunkOverlap,
    };
```

with:

```ts
    const newIndex: RagIndex = {
      meta: allMeta,
      dimension,
      fileChecksums: newChecksums,
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
      chunkSize: ragSetting.chunkSize,
      chunkOverlap: ragSetting.chunkOverlap,
      chunkStrategy: ragSetting.chunkStrategy ?? "fixed",
    };
```

- [ ] **Step 7: Wire `syncFile()` to use `chunkContent` + extend its index**

In `src/core/ragStore.ts` `syncFile()`, replace the chunking call on line 557:

```ts
        const chunks = chunkText(content, ragSetting.chunkSize, ragSetting.chunkOverlap);
```

with:

```ts
        const chunks = chunkContent(content, ragSetting);
```

Then update the `newIndex` built in `syncFile()` (around lines 603-610). Replace:

```ts
    const newIndex: RagIndex = {
      meta: keptMeta,
      dimension: newDimension,
      fileChecksums: checksums,
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
      chunkSize: ragSetting.chunkSize,
      chunkOverlap: ragSetting.chunkOverlap,
    };
```

with:

```ts
    const newIndex: RagIndex = {
      meta: keptMeta,
      dimension: newDimension,
      fileChecksums: checksums,
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
      chunkSize: ragSetting.chunkSize,
      chunkOverlap: ragSetting.chunkOverlap,
      chunkStrategy: ragSetting.chunkStrategy ?? "fixed",
    };
```

- [ ] **Step 8: Carry `chunkStrategy` through `mergeLoadedIndexes`**

In `src/core/ragStore.ts` `mergeLoadedIndexes`, update the returned index object (around lines 142-152). Replace:

```ts
  return {
    index: {
      meta: mergedMeta,
      dimension,
      fileChecksums: mergedChecksums,
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
      chunkSize: compatibleIndexes[0].index.chunkSize,
      chunkOverlap: compatibleIndexes[0].index.chunkOverlap,
    },
    vectors: mergedVectors,
  };
```

with:

```ts
  return {
    index: {
      meta: mergedMeta,
      dimension,
      fileChecksums: mergedChecksums,
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
      chunkSize: compatibleIndexes[0].index.chunkSize,
      chunkOverlap: compatibleIndexes[0].index.chunkOverlap,
      chunkStrategy: compatibleIndexes[0].index.chunkStrategy,
    },
    vectors: mergedVectors,
  };
```

- [ ] **Step 9: Type-check and run full test suite**

Run: `npx tsc -noEmit -skipLibCheck && npx vitest run src/core/ragStore.test.ts`
Expected: No type errors; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/core/ragStorage.ts src/core/ragStore.ts src/core/ragStore.test.ts
git commit -m "feat(rag): add chunkContent dispatcher and rebuild on strategy change"
```

---

## Task 5: Extend `RagSearchResult` with heading/startOffset (computed at search time)

**Files:**
- Modify: `src/core/ragStore.ts:42-48` (`RagSearchResult`), `src/core/ragStore.ts:627-682` (`search()`), `src/core/ragStore.ts:700-757` (`keywordSearch`)

- [ ] **Step 1: Extend `RagSearchResult`**

In `src/core/ragStore.ts`, update the `RagSearchResult` interface (lines 42-48):

```ts
export interface RagSearchResult {
  text: string;
  filePath: string;
  score: number;
  startOffset: number;        // chunk start offset in the source document
  heading?: string;           // nearest Markdown heading (omitted for PDFs)
  contentType?: string;       // "pdf" for PDF-origin chunks
  pageLabel?: string;         // PDF page range (e.g. "pages 1-6 of 24")
}
```

- [ ] **Step 2: Populate `heading`/`startOffset` in `search()`**

In `src/core/ragStore.ts` `search()`, replace the final return mapping (lines 675-681):

```ts
    return topK.map(({ index: idx, score }) => ({
      text: index.meta[idx].text,
      filePath: index.meta[idx].filePath,
      score,
      ...(index.meta[idx].contentType && { contentType: index.meta[idx].contentType }),
      ...(index.meta[idx].pageLabel && { pageLabel: index.meta[idx].pageLabel }),
    }));
```

with:

```ts
    // Compute headings at search time for markdown results (topK is small).
    // PDFs have no Markdown headings -> heading is omitted; pageLabel is used instead.
    // Read each unique markdown source file once, then resolve the nearest heading
    // per chunk from the full document content + the chunk's startOffset.
    const markdownPaths = new Set<string>();
    for (const { index: idx } of topK) {
      const meta = index.meta[idx];
      if (!meta.contentType && !meta.pageLabel) {
        markdownPaths.add(meta.filePath);
      }
    }
    const contentByFile = new Map<string, string>();
    for (const filePath of markdownPaths) {
      try {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (file) {
          const content = await app.vault.cachedRead(file as import("obsidian").TFile);
          contentByFile.set(filePath, content);
        }
      } catch {
        // File read failed — heading falls back to undefined (chip shows filename only).
      }
    }

    return topK.map(({ index: idx, score }) => {
      const meta = index.meta[idx];
      const isPdf = !!meta.contentType || !!meta.pageLabel;
      let heading: string | undefined;
      if (!isPdf && contentByFile.has(meta.filePath)) {
        const fullContent = contentByFile.get(meta.filePath)!;
        heading = findNearestHeading(fullContent, meta.startOffset);
      }
      return {
        text: meta.text,
        filePath: meta.filePath,
        score,
        startOffset: meta.startOffset,
        ...(!isPdf && heading !== undefined && heading !== "" ? { heading } : {}),
        ...(meta.contentType && { contentType: meta.contentType }),
        ...(meta.pageLabel && { pageLabel: meta.pageLabel }),
      };
    });
```

Since `search()` now uses `await app.vault.cachedRead(...)`, it is already `async` (line 627), so no signature change is needed. `TFile` is imported from `obsidian` at the top of the file (line 7).

- [ ] **Step 3: Populate `startOffset` in `keywordSearch()` and `getAdjacentChunk()`**

In `src/core/ragStore.ts` `keywordSearch()` return mapping (lines 747-756), add `startOffset`:

```ts
    return scored.slice(0, topK).map(r => {
      const meta = entry.index!.meta[r.index];
      return {
        filePath: meta.filePath,
        text: meta.text,
        score: r.score,
        startOffset: meta.startOffset,
        ...(meta.contentType && { contentType: meta.contentType }),
        ...(meta.pageLabel && { pageLabel: meta.pageLabel }),
      };
    });
```

In `getAdjacentChunk()` return (lines 781-787), add `startOffset`:

```ts
    const meta = fileChunks[targetPos].meta;
    return {
      filePath: meta.filePath,
      text: meta.text,
      score: 0,
      startOffset: meta.startOffset,
      ...(meta.contentType && { contentType: meta.contentType }),
      ...(meta.pageLabel && { pageLabel: meta.pageLabel }),
    };
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: No type errors. (Consumers of `RagSearchResult` that build `RagCitation` are added in Task 7; the `startOffset` field is now required on the interface so any existing construction sites must include it — `search`, `keywordSearch`, `getAdjacentChunk` are the only construction sites and all are updated above.)

- [ ] **Step 5: Run existing tests to confirm no regressions**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/ragStore.ts
git commit -m "feat(rag): include heading and startOffset in RagSearchResult"
```

---

## Task 6: Add i18n strings (en + ja)

**Files:**
- Modify: `src/i18n/en.ts` (add keys)
- Modify: `src/i18n/ja.ts` (add matching keys)

- [ ] **Step 1: Add English strings**

In `src/i18n/en.ts`, add the following keys. Insert the `input.ragToggle*` keys right after `"input.model": "Model",` (line 186), and the `message.ragCitation*` keys right after `"message.clickToSeeDetails"` (line 166), and the `settings.ragChunkStrategy*` keys right after `"settings.ragChunkOverlapDesc"` (line 92).

After `"input.model": "Model",`:

```ts
  "input.ragToggle": "RAG",
  "input.ragToggleTooltip": "Toggle RAG context for this chat (session-level)",
```

After `"message.clickToSeeDetails": "Click to see details",`:

```ts
  "message.ragCitationOpen": "Click to open at location",
```

After `"settings.ragChunkOverlapDesc": "Overlap between chunks (default: 200)",`:

```ts
  "settings.ragChunkStrategy": "Chunking strategy",
  "settings.ragChunkStrategyDesc": "How to split notes into chunks. For sentence/block, chunk size is a target/maximum, not a fixed size.",
  "settings.ragChunkStrategyFixed": "Fixed size",
  "settings.ragChunkStrategySentence": "By sentence",
  "settings.ragChunkStrategyBlock": "By block",
  "settings.ragChunkStrategyFixedDesc": "Split into fixed-size chunks with overlap (default)",
  "settings.ragChunkStrategySentenceDesc": "Split on sentence terminators (。/.), group up to chunk size",
  "settings.ragChunkStrategyBlockDesc": "Split on blank lines; large blocks are re-split by sentence",
```

- [ ] **Step 2: Add Japanese strings**

In `src/i18n/ja.ts`, add the matching keys. Insert after `"input.model": "モデル",` (line 186):

```ts
  "input.ragToggle": "RAG",
  "input.ragToggleTooltip": "このチャットのRAGコンテキストを切り替え（セッション単位）",
```

After `"message.clickToSeeDetails": "クリックして詳細を表示",` (line 166):

```ts
  "message.ragCitationOpen": "クリックして該当位置を開く",
```

After `"settings.ragChunkOverlapDesc": "チャンク間のオーバーラップ（デフォルト: 200）",` (line 92):

```ts
  "settings.ragChunkStrategy": "チャンク分割戦略",
  "settings.ragChunkStrategyDesc": "ノートをチャンクに分割する方法。文章/ブロックの場合、チャンクサイズは目安/上限であり固定サイズではありません。",
  "settings.ragChunkStrategyFixed": "固定サイズ",
  "settings.ragChunkStrategySentence": "文章単位",
  "settings.ragChunkStrategyBlock": "ブロック単位",
  "settings.ragChunkStrategyFixedDesc": "オーバーラップ付きの固定サイズに分割（デフォルト）",
  "settings.ragChunkStrategySentenceDesc": "句点（。/.）で分割し、チャンクサイズまでまとめる",
  "settings.ragChunkStrategyBlockDesc": "空行で分割。大きいブロックは文章単位で再分割",
```

- [ ] **Step 3: Type-check (en.ts is the source of typed keys)**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: No errors. (`TranslationKey` is derived from `en`, so any `t("...")` call referencing the new keys is now valid.)

- [ ] **Step 4: Commit**

```bash
git add src/i18n/en.ts src/i18n/ja.ts
git commit -m "feat(i18n): add RAG toggle, citation, and chunk strategy strings"
```

---

## Task 7: Add RAG toggle checkbox in `InputArea.tsx`

**Files:**
- Modify: `src/ui/components/InputArea.tsx:19-44` (props), `src/ui/components/InputArea.tsx:607-622` (RAG selector block)

- [ ] **Step 1: Add `ragEnabled` and `onRagToggle` props**

In `src/ui/components/InputArea.tsx`, add two fields to `InputAreaProps` (after `onRagSettingChange` on line 31):

```ts
  ragEnabled: boolean;
  onRagToggle: (enabled: boolean) => void;
```

Destructure them in the component params (after `onRagSettingChange,` on line 79):

```ts
  ragEnabled,
  onRagToggle,
```

- [ ] **Step 2: Render the checkbox before the RAG `<select>`**

In `src/ui/components/InputArea.tsx`, replace the RAG selector block (lines 607-622):

```tsx
          {ragSettingNames.length > 0 && (
            <>
              <label className="llm-hub-model-label">RAG</label>
              <select
                className="llm-hub-model-dropdown"
                value={selectedRagSetting || ""}
                onChange={(e) => onRagSettingChange(e.target.value || null)}
                disabled={isLoading}
              >
                <option value="">{t("settings.ragNone")}</option>
                {ragSettingNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </>
          )}
```

with:

```tsx
          {ragSettingNames.length > 0 && (
            <>
              <label
                className="llm-hub-rag-toggle"
                title={t("input.ragToggleTooltip")}
              >
                <input
                  type="checkbox"
                  checked={ragEnabled}
                  onChange={(e) => onRagToggle(e.target.checked)}
                  disabled={isLoading}
                />
                {t("input.ragToggle")}
              </label>
              <select
                className="llm-hub-model-dropdown"
                value={selectedRagSetting || ""}
                onChange={(e) => onRagSettingChange(e.target.value || null)}
                disabled={isLoading}
              >
                <option value="">{t("settings.ragNone")}</option>
                {ragSettingNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </>
          )}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: Errors at `Chat.tsx` (the consumer) because it does not yet pass the two new props. That is expected and fixed in Task 8.

- [ ] **Step 4: Commit (will build cleanly after Task 8; commit together with Task 8)**

Hold the commit until Task 8 wires the props from `Chat.tsx`, so the repo stays green.

---

## Task 8: Wire `ragEnabled` state + conditional search + citation building in `Chat.tsx`

**Files:**
- Modify: `src/ui/components/Chat.tsx:73` (state), `src/ui/components/Chat.tsx:622-647` (RAG search block), `src/ui/components/Chat.tsx:842-855` (assistant message), `src/ui/components/Chat.tsx:882` (deps), `src/ui/components/Chat.tsx:977-981` (InputArea props)

- [ ] **Step 1: Add the import for `RagCitation`**

In `src/ui/components/Chat.tsx`, update the type import from `src/types` (lines 12-19) to also import `RagCitation`:

```ts
import {
  type Message,
  type Attachment,
  type VaultToolMode,
  type ToolCall,
  type ToolResult,
  type RagCitation,
  WORKSPACE_FOLDER,
} from "src/types";
```

- [ ] **Step 2: Add `ragEnabled` state**

In `src/ui/components/Chat.tsx`, add the state right after `selectedRagSetting` (line 73):

```ts
  const [ragEnabled, setRagEnabled] = useState(true);
```

- [ ] **Step 3: Make the RAG search block conditional + build citations**

In `src/ui/components/Chat.tsx`, replace the RAG context injection block (lines 622-647):

```ts
      // RAG context injection
      let ragSources: string[] | undefined;
      if (selectedRagSetting) {
        const ragSetting = plugin.getRagSearchSetting(selectedRagSetting);
        if (ragSetting) {
          try {
            const store = getRagStore();
            const results = await store.search(
              selectedRagSetting,
              resolvedContent,
              ragSetting,
              llmConfig,
              plugin.app,
            );
            if (results.length > 0) {
              ragSources = [...new Set(results.map(r => r.filePath))];
              const ragContext = results
                .map(r => `[Source: ${r.filePath}]\n${r.text}`)
                .join("\n\n---\n\n");
              systemPrompt += `\n\nRelevant context from user's notes (use this to answer the question):\n\n${ragContext}`;
            }
          } catch (err) {
            console.warn("RAG search failed:", formatError(err));
          }
        }
      }
```

with:

```ts
      // RAG context injection (only when a setting is selected AND RAG is enabled for this session)
      let ragSources: string[] | undefined;
      let ragCitations: RagCitation[] | undefined;
      if (selectedRagSetting && ragEnabled) {
        const ragSetting = plugin.getRagSearchSetting(selectedRagSetting);
        if (ragSetting) {
          try {
            const store = getRagStore();
            const results = await store.search(
              selectedRagSetting,
              resolvedContent,
              ragSetting,
              llmConfig,
              plugin.app,
            );
            if (results.length > 0) {
              // Back-compat: deduped file paths for old saved chats.
              ragSources = [...new Set(results.map(r => r.filePath))];
              // New: one citation per result chunk, preserving order.
              ragCitations = results.map(r => ({
                filePath: r.filePath,
                ...(r.heading ? { heading: r.heading } : {}),
                startOffset: r.startOffset,
                snippet: r.text.slice(0, 120),
                ...(r.pageLabel ? { pageLabel: r.pageLabel } : {}),
              }));
              const ragContext = results
                .map(r => {
                  const loc = r.pageLabel
                    ? `[Source: ${r.filePath} (${r.pageLabel})]`
                    : r.heading
                      ? `[Source: ${r.filePath} > ${r.heading}]`
                      : `[Source: ${r.filePath}]`;
                  return `${loc}\n${r.text}`;
                })
                .join("\n\n---\n\n");
              systemPrompt += `\n\nRelevant context from user's notes (use this to answer the question):\n\n${ragContext}`;
            }
          } catch (err) {
            console.warn("RAG search failed:", formatError(err));
          }
        }
      }
```

- [ ] **Step 4: Attach `ragCitations` to the assistant message**

In `src/ui/components/Chat.tsx`, update the `assistantMessage` object (lines 842-855). Replace:

```ts
      const assistantMessage: Message = {
        role: "assistant",
        content: fullContent,
        timestamp: Date.now(),
        model: llmConfig.model || "local-llm",
        thinking: thinkingContent || undefined,
        ragUsed: !!ragSources,
        ragSources,
        skillsUsed: skillsUsedNames,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        toolResults: allToolResults.length > 0 ? allToolResults : undefined,
        usage,
        elapsedMs,
      };
```

with:

```ts
      const assistantMessage: Message = {
        role: "assistant",
        content: fullContent,
        timestamp: Date.now(),
        model: llmConfig.model || "local-llm",
        thinking: thinkingContent || undefined,
        ragUsed: !!ragSources,
        ragSources,
        ragCitations,
        skillsUsed: skillsUsedNames,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        toolResults: allToolResults.length > 0 ? allToolResults : undefined,
        usage,
        elapsedMs,
      };
```

- [ ] **Step 5: Add `ragEnabled` to the `sendMessage` dependency array**

In `src/ui/components/Chat.tsx`, update the `useCallback` deps (line 882). Replace:

```ts
  }, [messages, plugin, llmConfig, selectedRagSetting, vaultToolMode, ragAvailable, resolveMessageVariables, saveCurrentChat, activeSkillPaths, availableSkills, enabledMcpServerIds]);
```

with:

```ts
  }, [messages, plugin, llmConfig, selectedRagSetting, ragEnabled, vaultToolMode, ragAvailable, resolveMessageVariables, saveCurrentChat, activeSkillPaths, availableSkills, enabledMcpServerIds]);
```

- [ ] **Step 6: Pass `ragEnabled` and `onRagToggle` to `InputArea`**

In `src/ui/components/Chat.tsx`, update the `<InputArea>` JSX (around lines 977-981). Replace:

```tsx
        ragSettingNames={ragSettingNames}
        selectedRagSetting={selectedRagSetting}
        onRagSettingChange={(setting) => {
          setSelectedRagSetting(setting);
          void plugin.selectRagSetting(setting);
        }}
```

with:

```tsx
        ragSettingNames={ragSettingNames}
        selectedRagSetting={selectedRagSetting}
        ragEnabled={ragEnabled}
        onRagToggle={setRagEnabled}
        onRagSettingChange={(setting) => {
          setSelectedRagSetting(setting);
          void plugin.selectRagSetting(setting);
        }}
```

- [ ] **Step 7: Type-check and build**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: No errors (this resolves the InputArea prop errors from Task 7).

- [ ] **Step 8: Commit (covers Tasks 7 + 8)**

```bash
git add src/ui/components/InputArea.tsx src/ui/components/Chat.tsx
git commit -m "feat(rag): add session-level RAG toggle and citation building"
```

---

## Task 9: Render citation chips + click-to-scroll in `MessageBubble.tsx`

**Files:**
- Modify: `src/ui/components/MessageBubble.tsx:1-9` (imports), `src/ui/components/MessageBubble.tsx:145-167` (RAG indicator block)

- [ ] **Step 1: Add imports**

In `src/ui/components/MessageBubble.tsx`, update the type import (line 4) to include `RagCitation`:

```ts
import type { Message, ToolCall, ToolResult, RagCitation } from "src/types";
```

- [ ] **Step 2: Add the `scrollEditorToOffset` helper**

In `src/ui/components/MessageBubble.tsx`, add this helper function near the other free functions (e.g. after `openWorkflowInPanel`, around line 326):

```ts
/**
 * Open a Markdown file and scroll the editor to the chunk location.
 * Tries heading-line match first, then falls back to startOffset.
 * Wrapped in try/catch so a failure to scroll still opens the file.
 */
async function scrollEditorToOffset(
  app: App,
  filePath: string,
  heading: string | undefined,
  startOffset: number,
): Promise<void> {
  try {
    await app.workspace.openLinkText(filePath, "", false);
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    const editor = view.editor;
    const value = editor.getValue();

    let line = -1;
    if (heading && heading.trim().length > 0) {
      // Match a Markdown heading line whose text equals `heading`.
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const headingRe = new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, "m");
      const m = value.match(headingRe);
      if (m && m.index !== undefined) {
        line = value.slice(0, m.index).split("\n").length - 1;
      }
    }
    if (line < 0) {
      // Fallback: convert startOffset to a line number by counting newlines.
      const upTo = value.slice(0, Math.min(startOffset, value.length));
      line = upTo.split("\n").length - 1;
      if (line < 0) line = 0;
    }

    const pos = { line, ch: 0 };
    editor.setCursor(pos);
    editor.scrollIntoView({ from: pos, to: { line, ch: 0 } }, true);
  } catch (err) {
    console.warn("Local LLM Hub: failed to scroll to citation:", err);
  }
}

/** Build the display label for a citation chip. */
function citationLabel(c: RagCitation): string {
  const fileName = c.filePath.split("/").pop() || c.filePath;
  const icon = c.filePath.toLowerCase().endsWith(".pdf") ? "📄" : "📃";
  if (c.pageLabel) {
    return `${icon} ${fileName} (${c.pageLabel})`;
  }
  if (c.heading && c.heading.trim().length > 0) {
    return `${icon} ${fileName} > ${c.heading}`;
  }
  return `${icon} ${fileName}`;
}
```

Also add `MarkdownView` to the obsidian import on line 2:

```ts
import { type App, MarkdownRenderer, Component, Notice, MarkdownView } from "obsidian";
```

- [ ] **Step 3: Replace the RAG indicator block**

In `src/ui/components/MessageBubble.tsx`, replace the RAG indicator block (lines 145-167):

```tsx
      {/* RAG indicator */}
      {message.ragUsed && (
        <div className="llm-hub-rag-used">
          <span className="llm-hub-rag-indicator">
            {t("message.ragUsed")}
          </span>
          {message.ragSources && message.ragSources.length > 0 && (
            <div className="llm-hub-rag-sources">
              {message.ragSources.map((source, index) => (
                <span
                  key={index}
                  className="llm-hub-rag-source"
                  onClick={() => {
                    void app.workspace.openLinkText(source, "", false);
                  }}
                >
                  {source.split("/").pop() || source}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
```

with:

```tsx
      {/* RAG indicator */}
      {message.ragUsed && (
        <div className="llm-hub-rag-used">
          <span className="llm-hub-rag-indicator">
            {t("message.ragUsed")}
          </span>
          {(() => {
            // Prefer per-chunk citations; fall back to ragSources for old saved chats.
            if (message.ragCitations && message.ragCitations.length > 0) {
              return (
                <div className="llm-hub-rag-sources">
                  {message.ragCitations.map((citation, index) => (
                    <span
                      key={index}
                      className="llm-hub-rag-source"
                      title={citation.snippet}
                      onClick={() => {
                        const isPdf = citation.filePath.toLowerCase().endsWith(".pdf");
                        if (isPdf) {
                          // PDF viewer does not reliably expose scroll-to-page; just open.
                          void app.workspace.openLinkText(citation.filePath, "", false);
                        } else {
                          void scrollEditorToOffset(
                            app,
                            citation.filePath,
                            citation.heading,
                            citation.startOffset,
                          );
                        }
                      }}
                    >
                      {citationLabel(citation)}
                    </span>
                  ))}
                </div>
              );
            }
            if (message.ragSources && message.ragSources.length > 0) {
              return (
                <div className="llm-hub-rag-sources">
                  {message.ragSources.map((source, index) => (
                    <span
                      key={index}
                      className="llm-hub-rag-source"
                      title={t("message.ragCitationOpen")}
                      onClick={() => {
                        void app.workspace.openLinkText(source, "", false);
                      }}
                    >
                      {source.split("/").pop() || source}
                    </span>
                  ))}
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/MessageBubble.tsx
git commit -m "feat(rag): render citation chips with click-to-scroll"
```

---

## Task 10: Serialize/parse `ragCitations` in `chatHistory.ts`

**Files:**
- Modify: `src/ui/components/chat/chatHistory.ts:1-2` (import), `src/ui/components/chat/chatHistory.ts:29-42` (metadata build), `src/ui/components/chat/chatHistory.ts:97-118` (metadata restore)

- [ ] **Step 1: Import `RagCitation`**

In `src/ui/components/chat/chatHistory.ts`, update line 1:

```ts
import type { Message, RagCitation } from "src/types";
```

- [ ] **Step 2: Serialize `ragCitations`**

In `src/ui/components/chat/chatHistory.ts`, in `messagesToMarkdown`, after the `if (msg.ragSources) metadata.ragSources = msg.ragSources;` line (line 33), add:

```ts
    if (msg.ragCitations) metadata.ragCitations = msg.ragCitations;
```

- [ ] **Step 3: Parse `ragCitations`**

In `src/ui/components/chat/chatHistory.ts`, in `parseMarkdownToMessages`, after the `if (meta.ragSources) message.ragSources = meta.ragSources as string[];` line (line 105), add:

```ts
            if (meta.ragCitations) message.ragCitations = meta.ragCitations as RagCitation[];
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/chat/chatHistory.ts
git commit -m "feat(rag): persist ragCitations in chat history"
```

---

## Task 11: Add `chunkStrategy` dropdown in `ragSettings.ts`

**Files:**
- Modify: `src/ui/settings/ragSettings.ts:332-396` (insert dropdown before chunk-size)

- [ ] **Step 1: Add the strategy dropdown above chunk-size**

In `src/ui/settings/ragSettings.ts`, inside the `if (!isExternal && !isBundle)` block, insert a new `Setting` immediately **before** the "Chunk size" setting (before line 361, the `// Chunk size (vault sync only)` comment). Add:

```ts
    // Chunking strategy (vault sync only)
    new Setting(containerEl)
      .setName(t("settings.ragChunkStrategy"))
      .setDesc(t("settings.ragChunkStrategyDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("fixed", t("settings.ragChunkStrategyFixed"))
          .addOption("sentence", t("settings.ragChunkStrategySentence"))
          .addOption("block", t("settings.ragChunkStrategyBlock"))
          .setValue(ragSetting.chunkStrategy ?? "fixed")
          .onChange((value) => {
            void updateSetting({ chunkStrategy: value as ChunkStrategy }).catch((err) => new Notice(String(err)));
          });
      });

```

- [ ] **Step 2: Import `ChunkStrategy`**

In `src/ui/settings/ragSettings.ts`, update the type import (line 4):

```ts
import type { RagSetting, ChunkStrategy } from "src/types";
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc -noEmit -skipLibCheck && npm run build`
Expected: No errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/ui/settings/ragSettings.ts
git commit -m "feat(rag): add chunking strategy dropdown in settings"
```

---

## Task 12: Add CSS for the RAG toggle and citation chips

**Files:**
- Modify: `styles.css:353-364` (rag-source block)

- [ ] **Step 1: Add checkbox + citation chip styles**

In `styles.css`, locate the `.llm-hub-rag-source` block (around line 353). After the existing `.llm-hub-rag-source:hover { ... }` rule (line 364), add:

```css
.llm-hub-rag-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-ui-small);
  color: var(--text-normal);
  cursor: pointer;
  user-select: none;
}

.llm-hub-rag-toggle input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
}

/* Citation chips: same look as existing rag-source chips,
   but allow longer text (heading/pageLabel) without overflow. */
.llm-hub-rag-source {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 2: Verify the build still succeeds**

Run: `npm run build`
Expected: Build succeeds (CSS is bundled by esbuild).

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "style(rag): add RAG toggle and citation chip styles"
```

---

## Task 13: Final verification (type-check, lint, full test suite, build)

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing + new `chunkBySentence`, `chunkByBlock`, `chunkContent` tests).

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: No errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: No new lint errors. (Fix any that were introduced — primarily unused imports or the `MarkdownView` import if flagged.)

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: Build succeeds and emits `main.js`.

- [ ] **Step 5: Final commit if any fixups were needed**

If the lint/build steps required fixups:

```bash
git add -A
git commit -m "chore(rag): fix lint/build issues from RAG improvements"
```

---

## Notes for the implementer

- **Backward compatibility:** Old `RagIndex` JSON files on disk lack `chunkStrategy`; the `?? "fixed"` fallbacks in the rebuild check and `chunkContent` dispatcher handle this. Old saved chats lack `ragCitations`; `MessageBubble` falls back to `ragSources` filename chips. `DEFAULT_RAG_SETTING.chunkStrategy = "fixed"` keeps existing settings backward compatible.
- **`RagConfig` (legacy migration shape):** Intentionally left unchanged — migration treats a missing `chunkStrategy` as `"fixed"` via the same `?? "fixed"` fallback. No migration code change is needed because `RagConfig` is only used to seed a new `RagSetting`, which now defaults to `"fixed"`.
- **Async in `search()`:** `search()` is already `async`, so adding `await app.vault.cachedRead(...)` is safe. `cachedRead` is memoized by Obsidian, so repeated searches over the same files are cheap.
- **PDF citations:** The chip shows `📄 file.pdf (pages 2-5 of 24)` and click only opens the file (no scroll) — Obsidian's PDF viewer does not reliably expose scroll-to-page.
- **`MarkdownView` import:** Comes from the `obsidian` package (already a dependency). `getActiveViewOfType` is the standard Obsidian API.
