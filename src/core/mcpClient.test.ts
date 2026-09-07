import { beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "buffer";

const spawn = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({ spawn }));

import { McpClient } from "./mcpClient";

describe("McpClient", () => {
  beforeEach(() => {
    spawn.mockReset();
    vi.stubGlobal("window", {
      Buffer,
      process: { env: {} },
      setTimeout,
      clearTimeout,
    });
  });

  it("reports a process launch error without waiting for initialization timeout", async () => {
    let processError: ((error: Error) => void) | undefined;
    const child = {
      stdin: { destroyed: false, write: vi.fn(), on: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      killed: false,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
      on: vi.fn((event: string, listener: (value: Error | number | null) => void) => {
        if (event === "error") processError = listener as (error: Error) => void;
      }),
    };
    spawn.mockReturnValue(child);

    const start = new McpClient("missing-node", []).start();
    processError?.(new Error("spawn missing-node ENOENT"));

    await expect(start).rejects.toThrow("MCP process error: spawn missing-node ENOENT");
  });

  it("sends tool input in the MCP arguments field", async () => {
    const client = new McpClient("node", []);
    const sendRequest = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    (client as unknown as { sendRequest: typeof sendRequest }).sendRequest = sendRequest;

    await expect(client.callTool("get-web-search-summaries", { query: "Obsidian" })).resolves.toBe("ok");
    expect(sendRequest).toHaveBeenCalledWith("tools/call", {
      name: "get-web-search-summaries",
      arguments: { query: "Obsidian" },
    });
  });
});
