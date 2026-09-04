import { existsSync } from "fs";

export interface CommandToken {
  value: string;
  /** True when any part of the token was wrapped in quotes. */
  quoted: boolean;
}

/**
 * Tokenizes a command line the way a user expects when typing into a settings
 * field: whitespace separates tokens, and double or single quotes group text
 * containing whitespace. Backslashes are NOT treated as escape characters so
 * Windows paths (C:\Program Files\...) survive intact.
 */
export function tokenizeCommandLine(line: string): CommandToken[] {
  const tokens: CommandToken[] = [];
  let current = "";
  let quoted = false;
  let quote: '"' | "'" | null = null;
  let inToken = false;

  for (const ch of line) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
      inToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push({ value: current, quoted });
        current = "";
        quoted = false;
        inToken = false;
      }
      continue;
    }
    current += ch;
    inToken = true;
  }
  if (inToken) tokens.push({ value: current, quoted });
  return tokens;
}

export function splitCommandLine(line: string): string[] {
  return tokenizeCommandLine(line).map((tok) => tok.value);
}

/**
 * Normalizes an MCP server command for child_process.spawn (which takes an
 * executable path plus an argument array, with no shell in between).
 *
 * Users frequently paste a full command line into the "Command" field, e.g.
 *   C:\Program Files\nodejs\node.exe "C:\Users\me\server\dist\index.js"
 * spawn would then look for an executable literally named after the whole
 * string and fail with ENOENT. Here the executable is separated from the rest
 * and the remaining tokens are prepended to the configured arguments.
 *
 * An unquoted executable path containing spaces is recognised when the first
 * token looks like a path (drive letter, slash, dot, or tilde prefix): the
 * following unquoted tokens are joined until one ends with a binary extension
 * (.exe/.cmd/.bat/.com) or the joined path exists on disk.
 */
export function normalizeSpawnCommand(command: string, args: string[]): { command: string; args: string[] } {
  const tokens = tokenizeCommandLine(command.trim());
  if (tokens.length === 0) return { command: "", args };
  if (tokens.length === 1) return { command: tokens[0].value, args };

  const execTokenCount = leadingExecutableTokenCount(tokens);
  const executable = tokens.slice(0, execTokenCount).map((tok) => tok.value).join(" ");
  const inlineArgs = tokens.slice(execTokenCount).map((tok) => tok.value);
  return { command: executable, args: [...inlineArgs, ...args] };
}

const BINARY_EXT = /\.(exe|cmd|bat|com)$/i;
const PATH_LIKE = /^([a-zA-Z]:[\\/]|[\\/]|\.{1,2}[\\/]|~[\\/])/;

function leadingExecutableTokenCount(tokens: CommandToken[]): number {
  const first = tokens[0];
  if (first.quoted || !PATH_LIKE.test(first.value) || BINARY_EXT.test(first.value)) return 1;

  let joined = first.value;
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.quoted || tok.value.startsWith("-")) break;
    joined += " " + tok.value;
    if (BINARY_EXT.test(tok.value) || fileExists(joined)) return i + 1;
  }
  return 1;
}

function fileExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/** Inverse of splitCommandLine: quotes tokens that contain whitespace. */
export function joinCommandLine(tokens: string[]): string {
  return tokens.map((tok) => (/\s/.test(tok) || tok.length === 0 ? `"${tok}"` : tok)).join(" ");
}
