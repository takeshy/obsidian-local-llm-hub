import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { handleCommandNode } from "./handlers/command";
import type { LocalLlmHubPlugin } from "../plugin";
import type { ToolDefinition } from "../types";

const stream = vi.hoisted(() => vi.fn());
vi.mock("../core/localLlmProvider", () => ({ localLlmChatStream: stream }));
beforeEach(() => stream.mockReset());

describe("command node permissions", () => {
  it.each([undefined, "false"])("uses node confirmation setting %s without changing the manager", async confirm => {
    let round = 0;
    stream.mockImplementation(async function* () {
      if (round++ === 0) yield { type: "tool_call", toolCall: { id: "1", name: "mcp__anki__addCard", args: {} } };
      yield { type: "done" };
    });
    const callTool = vi.fn(async () => "OK");
    const plugin = {
      settings: { llmConfig: {}, systemPrompt: "", vaultToolAllowedFolders: [] },
      mcpManager: { getAllTools: () => [], hasTool: (name: string) => name.startsWith("mcp__"), callTool },
    } as unknown as LocalLlmHubPlugin;
    await handleCommandNode({ id: "test", type: "command", canvasNodeId: "test", properties: {
      prompt: "Add a card", vaultTools: "readOnly", ...(confirm ? { confirm } : {}),
    } }, { variables: new Map(), logs: [] }, {} as App, plugin);
    expect(callTool).toHaveBeenCalledWith("mcp__anki__addCard", {}, confirm === "false");
    const tools = stream.mock.calls[0][4] as ToolDefinition[];
    expect(tools.map(t => t.function.name)).toContain("read_note");
    expect(tools.map(t => t.function.name)).not.toContain("create_note");
  });
});
