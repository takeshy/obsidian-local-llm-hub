import { spawn } from "child_process";
import type { McpFraming, ToolDefinition } from "../types";
import {
  getNodeBuffer,
  getNodeProcessEnv,
  type NodeBuffer,
  type NodeChildProcess,
  type NodeSpawn,
} from "./nodeCompat";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_LEGACY_PROTOCOL_VERSIONS = new Set([
  LEGACY_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
]);

type McpProtocolEra = "modern" | "legacy";

// JSON-RPC 2.0 types
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

// MCP tool schema from server
interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// MCP tools/call result
interface McpCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

interface McpDiscoverResult {
  supportedVersions: string[];
}

interface McpInitializeResult {
  protocolVersion: string;
}

export class McpClient {
  private process: NodeChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  private readBuffer: NodeBuffer = getNodeBuffer().alloc(0);
  private tools: McpToolInfo[] = [];
  private _ready = false;
  private stderrLog: string[] = [];
  private framing: McpFraming;
  private protocolEra: McpProtocolEra | null = null;

  constructor(
    private command: string,
    private args: string[],
    private env?: Record<string, string>,
    framing?: McpFraming,
  ) {
    this.framing = framing ?? "newline";
  }

  get ready(): boolean {
    return this._ready;
  }

  async start(): Promise<void> {
    const childEnv = { ...getNodeProcessEnv(), ...this.env };
    this.process = (spawn as unknown as NodeSpawn)(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
    });

    this.process.stdout!.on("data", (data: Uint8Array) => {
      this.handleData(data);
    });

    this.process.stderr!.on("data", (data: NodeBuffer) => {
      const msg = data.toString("utf8").trim();
      console.debug("[MCP stderr]", msg);
      this.stderrLog.push(msg);
      if (this.stderrLog.length > 20) this.stderrLog.shift();
    });

    this.process.stdin!.on("error", (err) => {
      console.error("[MCP stdin error]", err.message);
    });

    this.process.on("error", (err) => {
      console.error("[MCP process error]", err.message);
      this._ready = false;
    });

    this.process.on("close", (code) => {
      console.debug("[MCP process closed]", code);
      this._ready = false;
      const stderrMsg = this.stderrLog.join("\n");
      // Reject all pending requests
      for (const [, handler] of this.pending) {
        handler.reject(new Error(`MCP process closed (code=${code})${stderrMsg ? ": " + stderrMsg : ""}`));
      }
      this.pending.clear();
    });

    // Initialize the MCP session
    await this.initialize();
    this._ready = true;

    // List available tools
    await this.refreshTools();
  }

  async stop(): Promise<void> {
    this._ready = false;
    this.protocolEra = null;
    const proc = this.process;
    this.process = null;

    // Reject all pending requests
    for (const [, handler] of this.pending) {
      handler.reject(new Error("MCP client stopped"));
    }
    this.pending.clear();
    this.tools = [];

    if (proc && !proc.killed) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => {
          if (proc.exitCode === null && proc.signalCode === null) {
            proc.kill("SIGKILL");
          }
        }, 3000);
        proc.on("close", () => {
          window.clearTimeout(timer);
          resolve();
        });
        proc.kill("SIGTERM");
      });
    }
  }

  getTools(): ToolDefinition[] {
    return this.tools.map((tool) => this.toToolDefinition(tool));
  }

  getToolNames(): string[] {
    return this.tools.map((t) => t.name);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const result = (await this.sendRequest("tools/call", {
      name,
      arguments: args,
    })) as McpCallResult;

    const textParts = result.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!);

    const text = textParts.join("\n");
    if (result.isError) {
      throw new Error(text || "MCP tool call failed");
    }
    return text;
  }

  private async initialize(): Promise<void> {
    this.protocolEra = "modern";
    try {
      const discover = await this.sendRequest("server/discover", {}, 5000) as McpDiscoverResult;
      if (discover.supportedVersions?.includes(MODERN_PROTOCOL_VERSION)) {
        return;
      }
    } catch {
      // A 2025-era server reports MethodNotFound/UnsupportedProtocolVersion.
    }

    this.protocolEra = "legacy";
    const result = await this.sendRequest("initialize", {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "obsidian-local-llm-hub", version: "1.0.0" },
    }) as McpInitializeResult;
    if (!SUPPORTED_LEGACY_PROTOCOL_VERSIONS.has(result.protocolVersion)) {
      throw new Error(`MCP server negotiated unsupported protocol version: ${result.protocolVersion}`);
    }
    // Send initialized notification
    this.sendNotification("notifications/initialized");
  }

  private async refreshTools(): Promise<void> {
    const result = (await this.sendRequest("tools/list", {})) as {
      tools: McpToolInfo[];
    };
    this.tools = result.tools || [];
  }

  private toToolDefinition(tool: McpToolInfo): ToolDefinition {
    const properties: Record<string, { type: string; description: string; enum?: string[] }> = {};
    const schema = tool.inputSchema;

    if (schema?.properties) {
      for (const [key, value] of Object.entries(schema.properties)) {
        const prop = value as Record<string, unknown>;
        properties[key] = {
          type: (prop.type as string) || "string",
          description: (prop.description as string) || "",
        };
        if (Array.isArray(prop.enum)) {
          properties[key].enum = prop.enum as string[];
        }
      }
    }

    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters: {
          type: "object",
          properties,
          required: schema?.required,
        },
      },
    };
  }

  private serializeMessage(message: JsonRpcRequest | JsonRpcNotification): string {
    const json = JSON.stringify(message);
    if (this.framing === "newline") {
      return json + "\n";
    }
    // Content-Length framing (LSP-style)
    return `Content-Length: ${getNodeBuffer().byteLength(json)}\r\n\r\n${json}`;
  }

  private writeToStdin(data: string): void {
    if (!this.process?.stdin || this.process.stdin.destroyed) return;
    try {
      this.process.stdin.write(data);
    } catch {
      // stdin write failed - process likely closing
    }
  }

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
    timeoutOverride?: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process || this.process.killed) {
        reject(new Error("MCP process not running"));
        return;
      }

      const id = this.nextId++;
      const modern = this.protocolEra === "modern" || method === "server/discover";
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params: modern ? this.withModernMetadata(params) : params,
      };

      const timeoutMs = timeoutOverride ?? (method === "initialize" ? 120000 : 30000);
      const timeout = window.setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          window.clearTimeout(timeout);
          if (modern) {
            const resultType = value && typeof value === "object"
              ? (value as Record<string, unknown>).resultType
              : undefined;
            if (resultType !== "complete") {
              const label = typeof resultType === "string" ? resultType : resultType === undefined ? "missing" : "invalid";
              reject(new Error(`Unsupported MCP result type: ${label}`));
              return;
            }
          }
          resolve(value);
        },
        reject: (reason) => {
          window.clearTimeout(timeout);
          reject(reason);
        },
      });

      this.writeToStdin(this.serializeMessage(request));
    });
  }

  private withModernMetadata(params: Record<string, unknown>): Record<string, unknown> {
    const existingMeta = params._meta && typeof params._meta === "object"
      ? params._meta as Record<string, unknown>
      : {};
    return {
      ...params,
      _meta: {
        ...existingMeta,
        "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": { name: "obsidian-local-llm-hub", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    };
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.process || this.process.killed) return;

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      ...(params ? { params } : {}),
    };

    this.writeToStdin(this.serializeMessage(notification));
  }

  private handleData(data: Uint8Array): void {
    this.readBuffer = getNodeBuffer().concat([this.readBuffer, data]);
    if (this.framing === "newline") {
      this.parseNewlineDelimited();
    } else {
      this.parseContentLength();
    }
  }

  // Parse newline-delimited JSON messages (Python MCP SDK)
  private parseNewlineDelimited(): void {
    while (true) {
      const newlineIdx = this.readBuffer.indexOf(0x0a); // \n
      if (newlineIdx === -1) break;

      const line = this.readBuffer.subarray(0, newlineIdx).toString("utf8").trim();
      this.readBuffer = this.readBuffer.subarray(newlineIdx + 1);

      if (!line) continue;

      try {
        const message = JSON.parse(line) as unknown as JsonRpcResponse;
        this.dispatchMessage(message);
      } catch {
        // Skip unparseable lines
      }
    }
  }

  // Parse Content-Length framed messages (TypeScript MCP SDK)
  private parseContentLength(): void {
    while (true) {
      const separator = "\r\n\r\n";
      const separatorIdx = this.readBuffer.indexOf(separator);
      if (separatorIdx === -1) break;

      const header = this.readBuffer.subarray(0, separatorIdx).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.readBuffer = this.readBuffer.subarray(separatorIdx + separator.length);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = separatorIdx + separator.length;

      if (this.readBuffer.length < bodyStart + contentLength) break;

      const body = this.readBuffer.subarray(bodyStart, bodyStart + contentLength).toString("utf8");
      this.readBuffer = this.readBuffer.subarray(bodyStart + contentLength);

      try {
        const message = JSON.parse(body) as unknown as JsonRpcResponse;
        this.dispatchMessage(message);
      } catch {
        // Skip unparseable messages
      }
    }
  }

  private dispatchMessage(message: JsonRpcResponse): void {
    if (message.id != null && this.pending.has(message.id)) {
      const handler = this.pending.get(message.id)!;
      this.pending.delete(message.id);

      if (message.error) {
        handler.reject(
          new Error(
            `MCP error (${message.error.code}): ${message.error.message}`,
          ),
        );
      } else {
        handler.resolve(message.result);
      }
    }
    // Ignore notifications from server (no id)
  }
}
