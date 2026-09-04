import { describe, expect, it } from "vitest";
import { joinCommandLine, normalizeSpawnCommand, splitCommandLine } from "./commandLine";

describe("splitCommandLine", () => {
  it("splits on whitespace", () => {
    expect(splitCommandLine("  npx -y  @scope/pkg ")).toEqual(["npx", "-y", "@scope/pkg"]);
  });

  it("keeps quoted segments together and strips the quotes", () => {
    expect(splitCommandLine('node "C:\\Users\\me\\my app\\index.js" --port 3000')).toEqual([
      "node",
      "C:\\Users\\me\\my app\\index.js",
      "--port",
      "3000",
    ]);
    expect(splitCommandLine("python '/home/me/my dir/server.py'")).toEqual(["python", "/home/me/my dir/server.py"]);
  });

  it("does not treat backslashes as escapes", () => {
    expect(splitCommandLine("C:\\tools\\node.exe")).toEqual(["C:\\tools\\node.exe"]);
  });

  it("returns an empty array for blank input", () => {
    expect(splitCommandLine("   ")).toEqual([]);
  });
});

describe("normalizeSpawnCommand", () => {
  it("leaves a simple command untouched", () => {
    expect(normalizeSpawnCommand("npx", ["-y", "pkg"])).toEqual({ command: "npx", args: ["-y", "pkg"] });
  });

  it("splits a full command line pasted into the command field", () => {
    expect(
      normalizeSpawnCommand('C:\\Program Files\\nodejs\\node.exe "C:\\Users\\takes\\programs\\web-search-mcp\\dist\\index.js"', []),
    ).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Users\\takes\\programs\\web-search-mcp\\dist\\index.js"],
    });
  });

  it("prepends inline tokens before configured arguments", () => {
    expect(normalizeSpawnCommand("node server.js", ["--verbose"])).toEqual({
      command: "node",
      args: ["server.js", "--verbose"],
    });
  });

  it("keeps an unquoted executable path containing spaces whole", () => {
    expect(normalizeSpawnCommand("C:\\Program Files\\nodejs\\node.exe", ["index.js"])).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["index.js"],
    });
  });

  it("strips quotes around a quoted executable path", () => {
    expect(normalizeSpawnCommand('"C:\\Program Files\\nodejs\\node.exe"', ["index.js"])).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["index.js"],
    });
  });
});

describe("normalizeSpawnCommand (path detection)", () => {
  it("splits a plain executable name from a path-like argument", () => {
    expect(normalizeSpawnCommand("node C:\\srv\\index.js", [])).toEqual({ command: "node", args: ["C:\\srv\\index.js"] });
  });

  it("stops joining at flags", () => {
    expect(normalizeSpawnCommand("C:\\tools\\node.exe -e code", [])).toEqual({
      command: "C:\\tools\\node.exe",
      args: ["-e", "code"],
    });
  });

  it("joins an unquoted unix path with spaces when the file exists", () => {
    expect(normalizeSpawnCommand("/bin/sh -c echo", [])).toEqual({ command: "/bin/sh", args: ["-c", "echo"] });
  });

  it("falls back to the first token for unknown unix paths with spaces", () => {
    expect(normalizeSpawnCommand("/no/such dir/bin serve", [])).toEqual({
      command: "/no/such",
      args: ["dir/bin", "serve"],
    });
  });
});

describe("joinCommandLine", () => {
  it("round-trips arguments containing spaces", () => {
    const args = ["-y", "pkg", "C:\\Users\\me\\my app\\index.js"];
    expect(splitCommandLine(joinCommandLine(args))).toEqual(args);
  });
});
