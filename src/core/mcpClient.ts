import { spawn, type ChildProcess } from "child_process";
import type { ToolDefinition } from "../types";

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

export class McpClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  private readBuffer = Buffer.alloc(0);
  private tools: McpToolInfo[] = [];
  private _ready = false;

  constructor(
    private command: string,
    private args: string[],
    private env?: Record<string, string>,
  ) {}

  get ready(): boolean {
    return this._ready;
  }

  async start(): Promise<void> {
    const childEnv = { ...process.env, ...this.env };
    this.process = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
    });

    this.process.stdout!.on("data", (data: Buffer) => {
      this.handleData(data);
    });

    this.process.stderr!.on("data", (data: Buffer) => {
      console.debug("[MCP stderr]", data.toString("utf8").trim());
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
      // Reject all pending requests
      for (const [, handler] of this.pending) {
        handler.reject(new Error("MCP process closed"));
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
        const timer = setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, 3000);
        proc.on("close", () => {
          clearTimeout(timer);
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
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "obsidian-local-llm-hub", version: "1.0.0" },
    });
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

  // Serialize a JSON-RPC message with Content-Length framing (MCP stdio protocol)
  private serializeMessage(message: JsonRpcRequest | JsonRpcNotification): string {
    const json = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
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
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process || this.process.killed) {
        reject(new Error("MCP process not running"));
        return;
      }

      const id = this.nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, 30000);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timeout);
          reject(reason);
        },
      });

      this.writeToStdin(this.serializeMessage(request));
    });
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

  // Parse Content-Length framed messages from the MCP stdio stream
  private handleData(data: Buffer): void {
    this.readBuffer = Buffer.concat([this.readBuffer, data]);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Look for the header/body separator
      const separator = "\r\n\r\n";
      const separatorIdx = this.readBuffer.indexOf(separator);
      if (separatorIdx === -1) break;

      // Parse Content-Length from header
      const header = this.readBuffer.subarray(0, separatorIdx).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Skip malformed header
        this.readBuffer = this.readBuffer.subarray(separatorIdx + separator.length);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = separatorIdx + separator.length;

      // Wait for full body
      if (this.readBuffer.length < bodyStart + contentLength) break;

      const body = this.readBuffer.subarray(bodyStart, bodyStart + contentLength).toString("utf8");
      this.readBuffer = this.readBuffer.subarray(bodyStart + contentLength);

      try {
        const message = JSON.parse(body) as JsonRpcResponse;
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
      } catch {
        // Skip unparseable messages
      }
    }
  }
}
