import { App, TFile } from "obsidian";
import { WorkflowNode, ExecutionContext, PromptCallbacks, FileExplorerData } from "../types";
import { replaceVariables } from "./utils";

// Binary file extensions
const BINARY_EXTENSIONS = [
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "tiff", "tif",
  "mp4", "mov", "avi", "mkv", "webm", "wmv", "flv", "m4v",
  "mp3", "wav", "ogg", "flac", "aac", "m4a", "wma",
  "zip", "rar", "7z", "tar", "gz", "bz2",
  "docx", "xlsx", "pptx", "doc", "xls", "ppt", "odt", "ods", "odp",
  "exe", "dll", "so", "dylib", "wasm", "ttf", "otf", "woff", "woff2", "eot",
];

function isBinaryExtension(extension: string): boolean {
  return BINARY_EXTENSIONS.includes(extension.toLowerCase());
}

function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    md: "text/markdown", txt: "text/plain", json: "application/json",
    csv: "text/csv", html: "text/html", css: "text/css",
    js: "application/javascript", ts: "application/typescript",
    xml: "application/xml", yaml: "application/x-yaml", yml: "application/x-yaml",
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon",
    svg: "image/svg+xml", tiff: "image/tiff", tif: "image/tiff",
    mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
    mkv: "video/x-matroska", webm: "video/webm",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac",
    aac: "audio/aac", m4a: "audio/mp4",
    zip: "application/zip", rar: "application/vnd.rar",
    "7z": "application/x-7z-compressed", tar: "application/x-tar",
    gz: "application/gzip", bz2: "application/x-bzip2",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    wasm: "application/wasm",
  };
  return mimeTypes[extension.toLowerCase()] || "application/octet-stream";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
  if (!folderPath) return;

  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (folder) return;

  const parentPath = folderPath.substring(0, folderPath.lastIndexOf("/"));
  if (parentPath) {
    await ensureFolderExists(app, parentPath);
  }

  try {
    await app.vault.createFolder(folderPath);
  } catch {
    // Folder might have been created by another process
  }
}

// Handle file-explorer node
export async function handleFileExplorerNode(
  node: WorkflowNode,
  context: ExecutionContext,
  app: App,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const mode = node.properties["mode"] || "select";
  const extensionsStr = node.properties["extensions"] || "";
  const defaultPath = replaceVariables(node.properties["default"] || "", context);
  const directPath = replaceVariables(node.properties["path"] || "", context);
  const saveTo = node.properties["saveTo"];
  const savePathTo = node.properties["savePathTo"];

  if (!saveTo && !savePathTo) {
    throw new Error("file-explorer node requires 'saveTo' or 'savePathTo' property");
  }

  const extensions = extensionsStr
    ? extensionsStr.split(",").map((e) => e.trim().toLowerCase().replace(/^\./, ""))
    : undefined;

  let filePath: string | null = null;

  if (directPath) {
    filePath = directPath;
  } else if (mode === "create") {
    if (!promptCallbacks?.promptForNewFilePath) {
      throw new Error("New file path prompt callback not available");
    }
    filePath = await promptCallbacks.promptForNewFilePath(extensions, defaultPath);
  } else {
    if (!promptCallbacks?.promptForAnyFile) {
      throw new Error("File picker callback not available");
    }
    filePath = await promptCallbacks.promptForAnyFile(extensions, defaultPath);
  }

  if (filePath === null) {
    throw new Error("File selection cancelled by user");
  }

  if (savePathTo) {
    context.variables.set(savePathTo, filePath);
  }

  if (saveTo) {
    if (mode === "create") {
      const basename = filePath.split("/").pop() || filePath;
      const lastDotIndex = basename.lastIndexOf(".");
      const name = lastDotIndex > 0 ? basename.substring(0, lastDotIndex) : basename;
      const extension = lastDotIndex > 0 ? basename.substring(lastDotIndex + 1) : "";

      const fileData: FileExplorerData = {
        path: filePath,
        basename,
        name,
        extension,
        mimeType: getMimeType(extension),
        contentType: isBinaryExtension(extension) ? "binary" : "text",
        data: "",
      };
      context.variables.set(saveTo, JSON.stringify(fileData));
    } else {
      const file = app.vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const extension = file.extension.toLowerCase();
      const mimeType = getMimeType(extension);
      const isBinary = isBinaryExtension(extension);

      let data: string;
      if (isBinary) {
        const buffer = await app.vault.readBinary(file);
        data = arrayBufferToBase64(buffer);
      } else {
        data = await app.vault.read(file);
      }

      const fileData: FileExplorerData = {
        path: filePath,
        basename: file.basename + "." + file.extension,
        name: file.basename,
        extension,
        mimeType,
        contentType: isBinary ? "binary" : "text",
        data,
      };
      context.variables.set(saveTo, JSON.stringify(fileData));
    }
  }
}

// Handle file-save node
export async function handleFileSaveNode(
  node: WorkflowNode,
  context: ExecutionContext,
  app: App
): Promise<void> {
  const sourceProp = node.properties["source"];
  const pathProp = node.properties["path"];

  if (!sourceProp) {
    throw new Error("file-save node requires 'source' property");
  }
  if (!pathProp) {
    throw new Error("file-save node requires 'path' property");
  }

  const sourceValue = context.variables.get(sourceProp);
  if (!sourceValue || typeof sourceValue !== "string") {
    throw new Error(`Source variable '${sourceProp}' not found or not a string`);
  }

  let fileData: FileExplorerData;
  try {
    fileData = JSON.parse(sourceValue);
    if (!fileData.data || !fileData.contentType) {
      throw new Error("Invalid FileExplorerData structure");
    }
  } catch {
    throw new Error(`Source variable '${sourceProp}' is not valid FileExplorerData JSON`);
  }

  let filePath = replaceVariables(pathProp, context);

  if (!filePath.includes(".") && fileData.extension) {
    filePath = `${filePath}.${fileData.extension}`;
  }

  const folderPath = filePath.substring(0, filePath.lastIndexOf("/"));
  if (folderPath) {
    await ensureFolderExists(app, folderPath);
  }

  const existingFile = app.vault.getAbstractFileByPath(filePath);

  if (fileData.contentType === "binary") {
    const binaryData = base64ToUint8Array(fileData.data);
    const arrayBuffer = binaryData.buffer.slice(binaryData.byteOffset, binaryData.byteOffset + binaryData.byteLength) as ArrayBuffer;

    if (existingFile && existingFile instanceof TFile) {
      await app.vault.modifyBinary(existingFile, arrayBuffer);
    } else {
      await app.vault.createBinary(filePath, arrayBuffer);
    }
  } else {
    if (existingFile && existingFile instanceof TFile) {
      await app.vault.modify(existingFile, fileData.data);
    } else {
      await app.vault.create(filePath, fileData.data);
    }
  }

  const savePathTo = node.properties["savePathTo"];
  if (savePathTo) {
    context.variables.set(savePathTo, filePath);
  }
}

// Handle open node
export async function handleOpenNode(
  node: WorkflowNode,
  context: ExecutionContext,
  _app: App,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const path = replaceVariables(node.properties["path"] || "", context);

  if (!path) {
    throw new Error("Open node missing 'path' property");
  }

  const notePath = path.endsWith(".md") ? path : `${path}.md`;

  if (promptCallbacks?.openFile) {
    await promptCallbacks.openFile(notePath);
  }
}
