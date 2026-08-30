import { type App, TFile, loadPdfJs } from "obsidian";

export interface PdfExtractResult {
  text: string;
  numPages: number;
  pageOffsets: number[];
}

interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: unknown }> }> }>;
}

interface PdfJsLib {
  getDocument(source: { data: ArrayBuffer }): { promise: Promise<PdfJsDocument> };
}

/** Extract the text layer from a PDF, preserving the starting offset of each page. */
export async function extractPdfText(app: App, file: TFile): Promise<PdfExtractResult | null> {
  const buffer = await app.vault.readBinary(file);
  const pdfjsLib = await loadPdfJs() as PdfJsLib;
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => typeof item.str === "string" ? item.str : "").join(" ");
    pageTexts.push(text.trim() ? text : "");
  }

  const parts: string[] = [];
  const pageOffsets: number[] = [];
  let offset = 0;
  for (const pageText of pageTexts) {
    if (pageText) {
      if (parts.length > 0) offset++;
      pageOffsets.push(offset);
      parts.push(pageText);
      offset += pageText.length;
    } else {
      pageOffsets.push(offset);
    }
  }
  if (parts.length === 0) return null;
  return { text: parts.join("\n"), numPages: pdf.numPages, pageOffsets };
}

/** A long PDF's text layer would otherwise crowd the rest of the conversation out of the context window. */
export const MAX_EXTRACTED_PDF_CHARS = 60_000;

/** Cap extracted PDF text, telling the model how much of the document it got. */
export function formatExtractedPdfText(extracted: PdfExtractResult): string {
  if (extracted.text.length <= MAX_EXTRACTED_PDF_CHARS) return extracted.text;
  const truncated = extracted.text.slice(0, MAX_EXTRACTED_PDF_CHARS);
  const pagesIncluded = extracted.pageOffsets.filter(offset => offset < truncated.length).length;
  return `${truncated}\n\n[Truncated: the first ${pagesIncluded} of ${extracted.numPages} pages (${truncated.length} of ${extracted.text.length} characters). Ask the user to narrow the request if a later page is needed.]`;
}
