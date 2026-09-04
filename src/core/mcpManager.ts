import { requireMcpApproval } from "./mcpApproval";
import type { McpServerConfig, ToolDefinition } from "../types";
import { normalizeSpawnCommand } from "./commandLine";
import { McpClient } from "./mcpClient";

export interface McpServerInfo {
  id: string;
  name: string;
  toolCount: number;
  toolNames: string[];
}

export class McpManager {
  private serverConfigs = new Map<string, McpServerConfig>();
  private clients = new Map<string, McpClient>();
  private serverNames = new Map<string, string>();
  private connecting = new Set<string>();

  async connectAll(servers: McpServerConfig[]): Promise<void> {
    // Stop removed/disabled servers
    for (const [id, client] of this.clients) {
      const config = servers.find((s) => s.id === id);
      if (!config || !config.enabled) {
        await client.stop();
        this.clients.delete(id);
        this.serverNames.delete(id);
        this.serverConfigs.delete(id);
      }
    }

    // Start new/enabled servers
    for (const config of servers) {
      if (!config.enabled || this.clients.has(config.id)) continue;
      await this.connectServer(config);
    }
  }

  /** True while connectServer() is spawning and handshaking with this server. */
  isConnecting(id: string): boolean {
    return this.connecting.has(id);
  }

  async connectServer(config: McpServerConfig): Promise<{ success: boolean; error?: string }> {
    // Mark synchronously so callers can re-render a "connecting" state right away.
    this.connecting.add(config.id);
    try {
      // Stop existing connection if any
      const existing = this.clients.get(config.id);
      if (existing) {
        await existing.stop();
        this.clients.delete(config.id);
        this.serverNames.delete(config.id);
        this.serverConfigs.delete(config.id);
      }

      const { command, args } = normalizeSpawnCommand(config.command, config.args);
      const client = new McpClient(command, args, config.env, config.framing, config.cwd, config.pluginRoot, config.pluginData);
      try {
        await client.start();
        this.clients.set(config.id, client);
        this.serverConfigs.set(config.id, { ...config, args: [...config.args], env: config.env ? { ...config.env } : undefined });
        this.serverNames.set(config.id, config.name);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[MCP] Failed to connect to ${config.name}:`, message);
        // Do not leave a half-started child process behind (e.g. after a handshake timeout).
        await client.stop();
        return { success: false, error: message };
      }
    } finally {
      this.connecting.delete(config.id);
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.stop();
      this.clients.delete(id);
      this.serverNames.delete(id);
      this.serverConfigs.delete(id);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [, client] of this.clients) {
      await client.stop();
    }
    this.clients.clear();
    this.serverNames.clear();
    this.serverConfigs.clear();
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  }

  private namespacedToolName(serverId: string, toolName: string): string {
    const serverName = this.serverNames.get(serverId) || serverId;
    return `mcp__${this.sanitizeName(serverName)}__${toolName}`;
  }

  private resolveNamespacedTool(name: string): { client: McpClient; originalName: string; config: McpServerConfig } | null {
    for (const [id, client] of this.clients) {
      if (!client.ready) continue;
      const serverName = this.serverNames.get(id) || id;
      const prefix = `mcp__${this.sanitizeName(serverName)}__`;
      if (name.startsWith(prefix)) {
        const originalName = name.slice(prefix.length);
        if (client.getToolNames().includes(originalName)) {
          const config = this.serverConfigs.get(id);
          if (config) return { client, originalName, config };
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

  async callTool(name: string, args: Record<string, unknown>, skipApproval = false): Promise<string> {
    const resolved = this.resolveNamespacedTool(name);
    if (!resolved) throw new Error(`MCP tool not found: ${name}`);
    if (!skipApproval) await requireMcpApproval(resolved.config, resolved.originalName, args);
    if (this.clients.get(resolved.config.id) !== resolved.client || !resolved.client.ready) {
      throw new Error("MCP server connection changed during approval");
    }
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
