import { describe, it, expect } from "vitest";
import { normalizeYamlText } from "./parser";

describe("normalizeYamlText", () => {
  describe("list marker conversion", () => {
    it("converts * list markers to - when followed by YAML key", () => {
      const input = `name: test
nodes:

* id: step1
  type: command

* id: step2
  type: dialog`;

      const result = normalizeYamlText(input);
      expect(result).toContain("- id: step1");
      expect(result).toContain("- id: step2");
      expect(result).not.toContain("* id:");
    });

    it("converts indented * list markers with YAML keys", () => {
      const input = `items:
  * name: a
  * name: b`;

      const result = normalizeYamlText(input);
      expect(result).toContain("  - name: a");
      expect(result).toContain("  - name: b");
    });

    it("does not convert * for non-YAML content (Markdown bullets)", () => {
      const input = `* A clear title
* Section headings
* Output Markdown only`;

      const result = normalizeYamlText(input);
      expect(result).toContain("* A clear title");
      expect(result).toContain("* Section headings");
      expect(result).toContain("* Output Markdown only");
    });

    it("does not convert * inside quoted strings", () => {
      const input = `message: "use * for emphasis"`;
      const result = normalizeYamlText(input);
      expect(result).toBe(input);
    });
  });

  describe("block scalar indentation fix", () => {
    it("fixes block scalar content at same indent as key", () => {
      const input = `- id: step1
  type: command
  prompt: |
  This is content
  that needs indentation
  saveTo: result`;

      const result = normalizeYamlText(input);
      expect(result).toContain("    This is content");
      expect(result).toContain("    that needs indentation");
      expect(result).toContain("  saveTo: result");
    });

    it("preserves blank lines within block scalar content", () => {
      const input = `- id: step1
  prompt: |
  First paragraph.

  Second paragraph.
  saveTo: result`;

      const result = normalizeYamlText(input);
      expect(result).toContain("    First paragraph.");
      expect(result).toContain("    Second paragraph.");
      // Blank line preserved
      const lines = result.split("\n");
      const firstIdx = lines.findIndex((l) => l.includes("First paragraph."));
      expect(lines[firstIdx + 1].trim()).toBe("");
    });

    it("does not re-indent already properly indented block scalars", () => {
      const input = `- id: step1
  prompt: |
    This is already properly indented
    No changes needed
  saveTo: result`;

      const result = normalizeYamlText(input);
      expect(result).toBe(input);
    });

    it("stops re-indentation at lowercase YAML property key", () => {
      const input = `- id: step1
  prompt: |
  Create something.
  saveTo: result
  comment: "done"`;

      const result = normalizeYamlText(input);
      expect(result).toContain("    Create something.");
      expect(result).toContain("  saveTo: result");
      expect(result).toContain('  comment: "done"');
    });

    it("does not treat uppercase words with colon as end of block scalar", () => {
      const input = `- id: step1
  prompt: |
  Requirements:
  Summary:
  More text here
  saveTo: result`;

      const result = normalizeYamlText(input);
      expect(result).toContain("    Requirements:");
      expect(result).toContain("    Summary:");
      expect(result).toContain("    More text here");
      expect(result).toContain("  saveTo: result");
    });

    it("does not treat multi-word keys as end of block scalar", () => {
      const input = `- id: step1
  prompt: |
  Some Content:
  Text Content:
  More text here
  saveTo: result`;

      const result = normalizeYamlText(input);
      expect(result).toContain("    Some Content:");
      expect(result).toContain("    Text Content:");
      expect(result).toContain("    More text here");
      expect(result).toContain("  saveTo: result");
    });

    it("stops re-indentation at new list item at lower indent", () => {
      const input = `- id: step1
  prompt: |
  Content here
- id: step2
  type: dialog`;

      const result = normalizeYamlText(input);
      expect(result).toContain("    Content here");
      expect(result).toContain("- id: step2");
    });

    it("does not break on Markdown * bullets inside block scalar", () => {
      const input = `- id: step1
  prompt: |
  Use the following:
  * Item one
  * Item two
  saveTo: result`;

      const result = normalizeYamlText(input);
      expect(result).toContain("    Use the following:");
      expect(result).toContain("    * Item one");
      expect(result).toContain("    * Item two");
      expect(result).toContain("  saveTo: result");
    });

    it("handles folded block scalar (>)", () => {
      const input = `- id: step1
  prompt: >
  Folded content
  continues here
  saveTo: result`;

      const result = normalizeYamlText(input);
      expect(result).toContain("    Folded content");
      expect(result).toContain("    continues here");
      expect(result).toContain("  saveTo: result");
    });

    it("handles block scalar with chomping indicator (|+, |-)", () => {
      const input = `- id: step1
  prompt: |+
  Keep trailing newlines
  saveTo: result`;

      const result = normalizeYamlText(input);
      expect(result).toContain("    Keep trailing newlines");
      expect(result).toContain("  saveTo: result");
    });

    it("handles the full infographic workflow with * bullets in prompt", () => {
      const input = `name: infographic-markdown
nodes:

* id: read-current-file
  type: prompt-file
  saveTo: content
  saveFileTo: fileInfo

* id: generate-markdown-infographic
  type: command
  prompt: |
  Convert the following note using:

  * A clear title
  * Section headings
  * Bullet lists

  Requirements:

  * Output Markdown only
  * Preserve the meaning

  Source content:
  {{content}}
  saveTo: markdownInfographic

* id: save-markdown-note
  type: note
  path: "{{fileInfo.name}}-infographic"
  content: "{{markdownInfographic}}"

* id: done
  type: dialog
  title: Done
  message: "Saved"`;

      const result = normalizeYamlText(input);

      // Top-level * converted to - (YAML key pattern)
      expect(result).toContain("- id: read-current-file");
      expect(result).toContain("- id: generate-markdown-infographic");
      expect(result).toContain("- id: save-markdown-note");
      expect(result).toContain("- id: done");

      // Block scalar content re-indented, * bullets preserved
      expect(result).toContain("    Convert the following note using:");
      expect(result).toContain("    * A clear title");
      expect(result).toContain("    * Section headings");
      expect(result).toContain("    Requirements:");
      expect(result).toContain("    * Output Markdown only");
      expect(result).toContain("    Source content:");
      expect(result).toContain("    {{content}}");

      // Property after block scalar preserved at original indent
      expect(result).toContain("  saveTo: markdownInfographic");

      // Other nodes unaffected
      expect(result).toContain('  path: "{{fileInfo.name}}-infographic"');
      expect(result).toContain("  title: Done");
    });
  });
});
