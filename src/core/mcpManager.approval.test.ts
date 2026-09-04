import { afterEach, describe, expect, it, vi } from "vitest";
import { McpManager } from "./mcpManager";
import { setMcpApprovalHandler } from "./mcpApproval";
import type { McpServerConfig } from "../types";

const callTool = vi.hoisted(() => vi.fn(async () => "OK"));
vi.mock("./mcpClient", () => ({ McpClient: class {
  ready = true;
  start() { return Promise.resolve(); }
  stop() { return Promise.resolve(); }
  getToolNames() { return ["deleteAll", "addCard"]; }
  callTool = callTool;
} }));
const server: McpServerConfig = { id: "anki", name: "Anki", command: "anki", args: [], framing: "newline", enabled: true };
afterEach(() => { setMcpApprovalHandler(undefined); callTool.mockClear(); });

describe("MCP manager approval", () => {
  it("does not send denied calls", async () => {
    const manager = new McpManager();
    await manager.connectServer(server);
    setMcpApprovalHandler({ getServer: () => server, request: async () => "deny", remember: async () => {} });
    await expect(manager.callTool("mcp__anki__deleteAll", {})).rejects.toThrow("denied");
    expect(callTool).not.toHaveBeenCalled();
  });
  it("limits workflow bypass to the explicitly exempt call", async () => {
    const manager = new McpManager();
    await manager.connectServer(server);
    const request = vi.fn(async () => "deny" as const);
    setMcpApprovalHandler({ getServer: () => server, request, remember: async () => {} });
    await manager.callTool("mcp__anki__addCard", { text: "test" }, true);
    expect(request).not.toHaveBeenCalled();
    expect(callTool).toHaveBeenCalledWith("addCard", { text: "test" });
    await expect(manager.callTool("mcp__anki__deleteAll", {})).rejects.toThrow("denied");
    expect(callTool).toHaveBeenCalledTimes(1);
  });
  it("rejects a call if its connection changes while approval is open", async () => {
    const manager = new McpManager();
    await manager.connectServer(server);
    setMcpApprovalHandler({ getServer: () => server, request: async () => {
      await manager.disconnectServer(server.id);
      return "once";
    }, remember: async () => {} });
    await expect(manager.callTool("mcp__anki__deleteAll", {})).rejects.toThrow("connection changed");
    expect(callTool).not.toHaveBeenCalled();
  });
});
