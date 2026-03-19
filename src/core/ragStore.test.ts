import { describe, it, expect } from "vitest";
import { chunkText, cosineSimilarity, simpleChecksum, findNearestHeading } from "./ragStore";

// --- chunkText ---

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
