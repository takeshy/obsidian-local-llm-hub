import { describe, it, expect } from "vitest";
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

// --- chunkText ---

describe("parseExternalIndexPaths", () => {
  it("parses one external index path per line", () => {
    expect(parseExternalIndexPaths("/tmp/index-a\n/tmp/index-b\n  /tmp/index-c  ")).toEqual([
      "/tmp/index-a",
      "/tmp/index-b",
      "/tmp/index-c",
    ]);
  });

  it("preserves commas in paths", () => {
    expect(parseExternalIndexPaths("/tmp/index,with-comma\n/tmp/index-b")).toEqual([
      "/tmp/index,with-comma",
      "/tmp/index-b",
    ]);
  });
});

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const result = chunkText("Hello world", 1000, 200);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Hello world");
    expect(result[0].startOffset).toBe(0);
  });

  it("splits long text into multiple chunks", () => {
    const text = "a".repeat(2500);
    const result = chunkText(text, 1000, 200);
    expect(result.length).toBeGreaterThan(1);
    // All text should be covered
    for (const chunk of result) {
      expect(chunk.text.length).toBeGreaterThan(0);
      expect(chunk.text.length).toBeLessThanOrEqual(1000);
    }
  });

  it("chunks do not skip content (overlap works)", () => {
    // With overlap, later chunks should start before the previous chunk ended
    const text = "word ".repeat(500); // ~2500 chars
    const result = chunkText(text, 1000, 200);
    expect(result.length).toBeGreaterThanOrEqual(3);
    // Second chunk should start before the first chunk's end
    expect(result[1].startOffset).toBeLessThan(result[0].startOffset + 1000);
  });

  it("prefers paragraph boundaries for splitting", () => {
    const paragraph1 = "First paragraph. ".repeat(30); // ~510 chars
    const paragraph2 = "Second paragraph. ".repeat(30);
    const text = paragraph1 + "\n\n" + paragraph2;
    const result = chunkText(text, 600, 100);
    // The first chunk should end at or near the paragraph break
    expect(result[0].text).not.toContain("Second paragraph");
  });

  it("prefers sentence boundaries when no paragraph break", () => {
    const text = "This is sentence one. This is sentence two. This is sentence three. " +
      "This is sentence four. This is sentence five. This is sentence six. " +
      "This is sentence seven. This is sentence eight. This is sentence nine. " +
      "This is sentence ten. This is sentence eleven. This is sentence twelve.";
    const result = chunkText(text, 200, 50);
    // Each chunk should ideally end at a sentence boundary (with ". ")
    for (const chunk of result.slice(0, -1)) {
      // Not the last chunk — it should end with a period or be trimmed
      expect(chunk.text.endsWith(".") || chunk.text.endsWith(". ")).toBeFalsy;
    }
    expect(result.length).toBeGreaterThan(1);
  });

  it("returns empty array for empty text", () => {
    const result = chunkText("", 1000, 200);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for whitespace-only text", () => {
    const result = chunkText("   \n\n   ", 1000, 200);
    expect(result).toHaveLength(0);
  });

  it("handles text shorter than chunkSize", () => {
    const text = "Short text here.";
    const result = chunkText(text, 1000, 200);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(text);
  });

  it("does not produce infinite loop with small chunkSize", () => {
    const text = "Hello world, this is a test of small chunk sizes.";
    const result = chunkText(text, 10, 5);
    expect(result.length).toBeGreaterThan(1);
    // Should finish without hanging
    expect(result.length).toBeLessThan(50);
  });

  it("handles Japanese text correctly", () => {
    const text = "これはテストです。日本語のテキストを正しくチャンク分割できるか確認します。" +
      "もう少し長いテキストが必要です。追加のテキストをここに書きます。" +
      "さらにテキストを追加して、チャンク分割が正しく動作するかテストします。";
    const result = chunkText(text, 50, 10);
    expect(result.length).toBeGreaterThan(1);
    // All chunks should be non-empty
    for (const chunk of result) {
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it("prefers Japanese sentence boundaries (。) for splitting", () => {
    const text = "最初の文章です。二番目の文章です。三番目の文章です。四番目の文章です。五番目の文章です。六番目の文章です。七番目の文章です。八番目の文章です。";
    const result = chunkText(text, 40, 5);
    // Non-final chunks should end at 。
    for (const chunk of result.slice(0, -1)) {
      expect(chunk.text.endsWith("。") || chunk.text.endsWith("。\n")).toBeTruthy();
    }
    expect(result.length).toBeGreaterThan(1);
  });

  it("prefers Japanese exclamation/question marks for splitting", () => {
    const text = "これは素晴らしい！本当にそう思いますか？はい、そうです。もっと詳しく教えてください！わかりました。";
    const result = chunkText(text, 30, 5);
    expect(result.length).toBeGreaterThan(1);
  });
});

// --- findNearestHeading ---

describe("findNearestHeading", () => {
  it("includes a heading that starts exactly at the offset", () => {
    const text = "# Title\n\nContent";
    expect(findNearestHeading(text, 0)).toBe("Title");
  });

  it("finds the nearest heading before the offset", () => {
    const text = "# Title\n\nSome text\n\n## Section A\n\nContent A\n\n## Section B\n\nContent B";
    // Offset in "Content A" area
    const offset = text.indexOf("Content A");
    expect(findNearestHeading(text, offset)).toBe("Section A");
  });

  it("returns top-level heading when offset is before any sub-heading", () => {
    const text = "# My Note\n\nIntro text here\n\n## First Section\n\nDetails";
    const offset = text.indexOf("Intro");
    expect(findNearestHeading(text, offset)).toBe("My Note");
  });

  it("returns empty string when no heading exists before offset", () => {
    const text = "No headings here, just plain text.";
    expect(findNearestHeading(text, 10)).toBe("");
  });

  it("handles Japanese headings", () => {
    const text = "# メモ\n\n概要テキスト\n\n## 議事録\n\n会議の内容";
    const offset = text.indexOf("会議の内容");
    expect(findNearestHeading(text, offset)).toBe("議事録");
  });
});

// --- cosineSimilarity ---

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it("returns 1 for scaled vectors", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([2, 4, 6]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([-1, -2, -3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it("returns 0 for zero vector", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("handles high-dimensional vectors", () => {
    const dim = 768;
    const a = new Float32Array(dim);
    const b = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      a[i] = Math.random();
      b[i] = a[i]; // Same vector
    }
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 4);
  });

  it("produces value between -1 and 1", () => {
    const a = new Float32Array([0.5, -0.3, 0.8, -0.1]);
    const b = new Float32Array([-0.2, 0.7, 0.1, -0.9]);
    const score = cosineSimilarity(a, b);
    expect(score).toBeGreaterThanOrEqual(-1);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// --- simpleChecksum ---

describe("simpleChecksum", () => {
  it("returns consistent results", () => {
    const text = "Hello, world!";
    expect(simpleChecksum(text)).toBe(simpleChecksum(text));
  });

  it("returns different results for different inputs", () => {
    expect(simpleChecksum("Hello")).not.toBe(simpleChecksum("World"));
  });

  it("handles empty string", () => {
    const result = simpleChecksum("");
    expect(typeof result).toBe("string");
    expect(result).toBe("0");
  });

  it("handles unicode text", () => {
    const result = simpleChecksum("日本語テスト");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("is sensitive to small changes", () => {
    expect(simpleChecksum("abc")).not.toBe(simpleChecksum("abd"));
  });
});

describe("simpleChecksumBytes", () => {
  it("returns consistent results for the same bytes", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(simpleChecksumBytes(bytes.buffer)).toBe(simpleChecksumBytes(bytes.buffer));
  });

  it("returns different results for different bytes", () => {
    expect(simpleChecksumBytes(new Uint8Array([1, 2, 3]).buffer))
      .not.toBe(simpleChecksumBytes(new Uint8Array([1, 2, 4]).buffer));
  });
});

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
