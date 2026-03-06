import { requestUrl } from "obsidian";
import { WorkflowNode, ExecutionContext, FileExplorerData } from "../types";
import { replaceVariables } from "./utils";

// Decode base64 string to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Try to parse FileExplorerData from string
function tryParseFileExplorerData(value: string): FileExplorerData | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && "contentType" in parsed && "data" in parsed && "mimeType" in parsed) {
      return parsed as FileExplorerData;
    }
  } catch {
    // Not JSON or not FileExplorerData
  }
  return null;
}

// Build multipart/form-data body with binary support
function buildMultipartBodyBinary(
  fields: Record<string, string>,
  boundary: string
): ArrayBuffer {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  for (const [name, value] of Object.entries(fields)) {
    const fileData = tryParseFileExplorerData(value);

    let headerStr = `--${boundary}\r\n`;

    const colonIndex = name.indexOf(":");

    if (fileData) {
      const fieldName = colonIndex !== -1 ? name.substring(0, colonIndex) : name;
      const filename = fileData.basename;
      headerStr += `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`;
      headerStr += `Content-Type: ${fileData.mimeType}\r\n\r\n`;
      parts.push(encoder.encode(headerStr));

      if (fileData.contentType === "binary" && fileData.data) {
        parts.push(base64ToUint8Array(fileData.data));
      } else {
        parts.push(encoder.encode(fileData.data));
      }
      parts.push(encoder.encode("\r\n"));
    } else if (colonIndex !== -1) {
      const fieldName = name.substring(0, colonIndex);
      const filename = name.substring(colonIndex + 1);
      const contentType = guessContentType(filename);
      headerStr += `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`;
      headerStr += `Content-Type: ${contentType}\r\n\r\n`;
      parts.push(encoder.encode(headerStr));
      parts.push(encoder.encode(value));
      parts.push(encoder.encode("\r\n"));
    } else {
      headerStr += `Content-Disposition: form-data; name="${name}"\r\n\r\n`;
      parts.push(encoder.encode(headerStr));
      parts.push(encoder.encode(value));
      parts.push(encoder.encode("\r\n"));
    }
  }

  parts.push(encoder.encode(`--${boundary}--\r\n`));

  const totalLength = parts.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result.buffer;
}

function guessContentType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  const types: Record<string, string> = {
    html: "text/html",
    htm: "text/html",
    txt: "text/plain",
    json: "application/json",
    xml: "application/xml",
    css: "text/css",
    js: "application/javascript",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
  };
  return types[ext || ""] || "application/octet-stream";
}

function isBinaryMimeType(mimeType: string): boolean {
  if (mimeType.startsWith("text/")) return false;
  if (mimeType === "application/json") return false;
  if (mimeType === "application/xml") return false;
  if (mimeType === "application/javascript") return false;
  if (mimeType.endsWith("+xml")) return false;
  if (mimeType.endsWith("+json")) return false;

  if (mimeType.startsWith("image/")) return true;
  if (mimeType.startsWith("audio/")) return true;
  if (mimeType.startsWith("video/")) return true;
  if (mimeType === "application/pdf") return true;
  if (mimeType === "application/zip") return true;
  if (mimeType === "application/x-zip-compressed") return true;
  if (mimeType === "application/octet-stream") return true;
  if (mimeType === "application/gzip") return true;
  if (mimeType === "application/x-tar") return true;

  return false;
}

function getMimeExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "text/plain": "txt",
    "text/html": "html",
    "application/json": "json",
    "application/xml": "xml",
  };
  return mimeToExt[mimeType] || "";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Handle HTTP request node
export async function handleHttpNode(
  node: WorkflowNode,
  context: ExecutionContext
): Promise<void> {
  const url = replaceVariables(node.properties["url"] || "", context);
  const method = (node.properties["method"] || "GET").toUpperCase();
  const contentType = node.properties["contentType"] || "json";

  if (!url) {
    throw new Error("HTTP node missing 'url' property");
  }

  const headers: Record<string, string> = {};

  const headersStr = node.properties["headers"];
  if (headersStr) {
    const replacedHeaders = replaceVariables(headersStr, context);
    try {
      const parsedHeaders = JSON.parse(replacedHeaders);
      Object.assign(headers, parsedHeaders);
    } catch {
      const lines = replacedHeaders.split("\n");
      for (const line of lines) {
        const colonIndex = line.indexOf(":");
        if (colonIndex !== -1) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          if (key) {
            headers[key] = value;
          }
        }
      }
    }
  }

  let body: string | ArrayBuffer | undefined;
  const bodyStr = node.properties["body"];

  if (bodyStr && (method === "POST" || method === "PUT" || method === "PATCH")) {
    if (contentType === "form-data") {
      try {
        const rawFields = JSON.parse(bodyStr);
        const fields: Record<string, string> = {};
        for (const [key, value] of Object.entries(rawFields)) {
          const expandedKey = replaceVariables(key, context);
          const expandedValue = replaceVariables(String(value), context);
          fields[expandedKey] = expandedValue;
        }
        const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
        body = buildMultipartBodyBinary(fields, boundary);
        headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
      } catch {
        throw new Error("form-data contentType requires body to be a valid JSON object");
      }
    } else if (contentType === "text") {
      body = replaceVariables(bodyStr, context);
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "text/plain";
      }
    } else if (contentType === "binary") {
      const replacedBody = replaceVariables(bodyStr, context);
      try {
        const fileData = JSON.parse(replacedBody);
        if (fileData.data && fileData.contentType === "binary") {
          const binaryStr = atob(fileData.data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          body = bytes.buffer;
          if (!headers["Content-Type"] && fileData.mimeType) {
            headers["Content-Type"] = fileData.mimeType;
          }
        } else {
          throw new Error("binary contentType requires FileExplorerData with binary content");
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("FileExplorerData")) {
          throw e;
        }
        throw new Error("binary contentType requires valid FileExplorerData JSON");
      }
    } else {
      body = replaceVariables(bodyStr, context);
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  let response;
  try {
    const requestOptions: Parameters<typeof requestUrl>[0] = {
      url,
      method,
    };

    if (Object.keys(headers).length > 0) {
      requestOptions.headers = headers;
    }

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      requestOptions.body = body;
    }

    response = await requestUrl(requestOptions);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`HTTP request failed: ${method} ${url} - ${errorMessage}`);
  }

  const saveStatus = node.properties["saveStatus"];
  if (saveStatus) {
    context.variables.set(saveStatus, response.status);
  }

  if (response.status >= 400 && node.properties["throwOnError"] === "true") {
    const responseText = response.text;
    throw new Error(`HTTP ${response.status} ${method} ${url}: ${responseText}`);
  }

  const responseType = node.properties["responseType"] || "auto";
  const contentTypeHeader = response.headers["content-type"] || "application/octet-stream";
  const mimeType = contentTypeHeader.split(";")[0].trim();
  const isBinary = responseType === "binary" ? true
    : responseType === "text" ? false
    : isBinaryMimeType(mimeType);
  const saveTo = node.properties["saveTo"];

  if (isBinary) {
    if (saveTo) {
      let basename = "download";
      let extension = "";
      try {
        const urlPath = new URL(url).pathname;
        const urlBasename = urlPath.split("/").pop();
        if (urlBasename && urlBasename.includes(".")) {
          basename = urlBasename;
          extension = urlBasename.split(".").pop() || "";
        }
      } catch {
        // URL parsing failed
      }

      if (!extension) {
        extension = getMimeExtension(mimeType);
        if (extension) {
          basename = `download.${extension}`;
        }
      }

      const name = basename.includes(".") ? basename.substring(0, basename.lastIndexOf(".")) : basename;

      const arrayBuffer = response.arrayBuffer;
      const base64Data = arrayBufferToBase64(arrayBuffer);

      const fileData: FileExplorerData = {
        path: "",
        basename,
        name,
        extension,
        mimeType,
        contentType: "binary",
        data: base64Data,
      };

      context.variables.set(saveTo, JSON.stringify(fileData));
    }
  } else {
    const responseText = response.text;

    let responseData: string;
    try {
      const jsonData = JSON.parse(responseText);
      responseData = JSON.stringify(jsonData);
    } catch {
      responseData = responseText;
    }

    if (saveTo) {
      context.variables.set(saveTo, responseData);
    }
  }
}
