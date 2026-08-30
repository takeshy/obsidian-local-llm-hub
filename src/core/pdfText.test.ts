import { describe, expect, it } from "vitest";
import { MAX_EXTRACTED_PDF_CHARS, formatExtractedPdfText } from "./pdfText";

describe("formatExtractedPdfText", () => {
  it("returns a short text layer unchanged", () => {
    const extracted = { text: "short", numPages: 1, pageOffsets: [0] };

    expect(formatExtractedPdfText(extracted)).toBe("short");
  });

  it("caps a long text layer and reports how much of the document it kept", () => {
    const text = "x".repeat(MAX_EXTRACTED_PDF_CHARS * 2);
    const result = formatExtractedPdfText({
      text,
      numPages: 3,
      pageOffsets: [0, MAX_EXTRACTED_PDF_CHARS - 1, MAX_EXTRACTED_PDF_CHARS + 1],
    });

    expect(result.startsWith("x".repeat(100))).toBe(true);
    expect(result).toContain(`the first 2 of 3 pages`);
    expect(result).toContain(`${MAX_EXTRACTED_PDF_CHARS} of ${text.length} characters`);
  });
});
