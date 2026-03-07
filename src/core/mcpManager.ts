import type { McpServerConfig, ToolDefinition } from "../types";
import { McpClient } from "./mcpClient";

export interface McpServerInfo {
  id: string;
  name: string;
  toolCount: number;
  toolNames: string[];
}

export class McpManager {
  private clients = new Map<string, McpClient>();
  private serverNames = new Map<string, string>();

  async connectAll(servers: McpServerConfig[]): Promise<void> {
    // Stop removed/disabled servers
    for (const [id, client] of this.clients) {
      const config = servers.find((s) => s.id === id);
      if (!config || !config.enabled) {
        await client.stop();
        this.clients.delete(id);
        this.serverNames.delete(id);
      }
    }

    // Start new/enabled servers
    for (const config of servers) {
      if (!config.enabled || this.clients.has(config.id)) continue;
      await this.connectServer(config);
    }
  }

  async connectServer(config: McpServerConfig): Promise<{ success: boolean; error?: string }> {
    // Stop existing connection if any
    const existing = this.clients.get(config.id);
    if (existing) {
      await existing.stop();
      this.clients.delete(config.id);
      this.serverNames.delete(config.id);
    }

    const client = new McpClient(config.command, config.args, config.env);
    try {
      await client.start();
      this.clients.set(config.id, client);
      this.serverNames.set(config.id, config.name);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[MCP] Failed to connect to ${config.name}:`, message);
      return { success: false, error: message };
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.stop();
      this.clients.delete(id);
      this.serverNames.delete(id);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [, client] of this.clients) {
      await client.stop();
    }
    this.clients.clear();
    this.serverNames.clear();
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  }

  private namespacedToolName(serverId: string, toolName: string): string {
    const serverName = this.serverNames.get(serverId) || serverId;
    return `mcp__${this.sanitizeName(serverName)}__${toolName}`;
  }

  private resolveNamespacedTool(name: string): { client: McpClient; originalName: string } | null {
    for (const [id, client] of this.clients) {
      if (!client.ready) continue;
      const serverName = this.serverNames.get(id) || id;
      const prefix = `mcp__${this.sanitizeName(serverName)}__`;
      if (name.startsWith(prefix)) {
        const originalName = name.slice(prefix.length);
        if (client.getToolNames().includes(originalName)) {
          return { client, originalName };
        }
      }
    }
    return null;
  }

  getAllTools(enabledServerIds?: string[]): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const [id, client] of this.clients) {
      if (!client.ready) continue;
      if (enabledServerIds && !enabledServerIds.includes(id)) continue;
      for (const tool of client.getTools()) {
        tools.push({
          ...tool,
          function: {
            ...tool.function,
            name: this.namespacedToolName(id, tool.function.name),
          },
        });
      }
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const resolved = this.resolveNamespacedTool(name);
    if (!resolved) throw new Error(`MCP tool not found: ${name}`);
    return resolved.client.callTool(resolved.originalName, args);
  }

  hasTool(name: string): boolean {
    return this.resolveNamespacedTool(name) !== null;
  }

  getConnectedServerIds(): string[] {
    const ids: string[] = [];
    for (const [id, client] of this.clients) {
      if (client.ready) ids.push(id);
    }
    return ids;
  }

  getServerInfos(): McpServerInfo[] {
    return Array.from(this.clients.entries())
      .filter(([, client]) => client.ready)
      .map(([id, client]) => ({
        id,
        name: this.serverNames.get(id) || id,
        toolCount: client.getToolNames().length,
        toolNames: client.getToolNames(),
      }));
  }
}
