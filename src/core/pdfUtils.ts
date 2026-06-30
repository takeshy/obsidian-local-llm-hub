import { App, TFile } from "obsidian";
import { PDFDocument } from "pdf-lib";

interface NodeFsReader {
  promises: { readFile: (p: string) => Promise<Buffer> };
}

function parsePageLabel(label: string): { startPage: number; endPage: number; totalPages: number } | null {
  const match = label.match(/pages?\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/i);
  if (!match) return null;
  return {
    startPage: parseInt(match[1], 10),
    endPage: parseInt(match[2], 10),
    totalPages: parseInt(match[3], 10),
  };
}

export async function extractPdfPages(
  app: App,
  filePath: string,
  pageLabel: string,
): Promise<ArrayBuffer | null> {
  const pageRange = parsePageLabel(pageLabel);
  if (!pageRange) return null;

  let pdfBytes: Uint8Array;
  const isAbsolute = filePath.startsWith("/") || /^[A-Z]:\\/i.test(filePath);
  if (isAbsolute) {
    const runtimeWindow = activeWindow as Window & { require?: (id: string) => unknown };
    const fs = runtimeWindow.require?.("fs") as NodeFsReader | undefined;
    if (!fs) return null;
    const buffer = await fs.promises.readFile(filePath);
    pdfBytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else {
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return null;
    const buffer = await app.vault.readBinary(file);
    pdfBytes = new Uint8Array(buffer);
  }

  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const chunkDoc = await PDFDocument.create();
  const indices = Array.from(
    { length: pageRange.endPage - pageRange.startPage + 1 },
    (_, i) => pageRange.startPage - 1 + i,
  ).filter(i => i < pdfDoc.getPageCount());
  const pages = await chunkDoc.copyPages(pdfDoc, indices);
  for (const page of pages) chunkDoc.addPage(page);
  const extractedBytes = await chunkDoc.save();
  const output = new Uint8Array(extractedBytes.byteLength);
  output.set(extractedBytes);
  return output.buffer;
}
