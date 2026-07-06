/**
 * Minimal structural typings for the Node.js APIs this desktop-only plugin
 * touches (fs, child_process, http, Buffer, process).
 *
 * These are declared locally instead of relying on `@types/node` so that
 * type-aware linting produces no "unsafe any" findings even in environments
 * where Node's type definitions are not resolved (e.g. the Obsidian plugin
 * review toolchain, which type-checks without `@types/node`).
 */

/** Subset of `fs.Dirent` used for directory walking. */
export interface NodeDirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

/** Subset of the `fs` module used by the plugin. */
export interface NodeFs {
  promises: {
    readdir(path: string, options: { withFileTypes: true }): Promise<NodeDirent[]>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
    readFile(path: string): Promise<Uint8Array>;
  };
}

/** Subset of a Node `Buffer` instance (a `Uint8Array` with extra methods). */
export interface NodeBuffer extends Uint8Array {
  subarray(begin?: number, end?: number): NodeBuffer;
  toString(encoding?: string): string;
  indexOf(value: string | number, byteOffset?: number): number;
}

/** Subset of the global `Buffer` constructor. */
export interface NodeBufferConstructor {
  alloc(size: number): NodeBuffer;
  concat(list: Uint8Array[]): NodeBuffer;
  byteLength(str: string): number;
}

/** Subset of a Node readable stream (stdout/stderr). */
export interface NodeReadable {
  on(event: "data", listener: (chunk: NodeBuffer) => void): void;
}

/** Subset of a Node writable stream (stdin). */
export interface NodeWritable {
  destroyed: boolean;
  write(data: string): void;
  on(event: "error", listener: (err: Error) => void): void;
}

/** Subset of `child_process.ChildProcess`. */
export interface NodeChildProcess {
  stdin: NodeWritable | null;
  stdout: NodeReadable | null;
  stderr: NodeReadable | null;
  killed: boolean;
  kill(signal?: string): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: (code: number | null) => void): void;
}

/** Subset of `child_process.spawn`. */
export type NodeSpawn = (
  command: string,
  args: string[],
  options: { stdio: string[]; env: Record<string, string | undefined> },
) => NodeChildProcess;

/** Subset of `http.IncomingMessage`. */
export interface NodeIncomingMessage {
  statusCode?: number;
  statusMessage?: string;
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

/** Subset of `http.ClientRequest`. */
export interface NodeClientRequest {
  on(event: "error", listener: (err: Error) => void): void;
  write(data: string): void;
  end(): void;
  destroy(): void;
}

/** Subset of the `http`/`https` module used by the plugin. */
export interface NodeHttpModule {
  request(
    options: {
      hostname: string;
      port: string;
      path: string;
      method: string;
      headers: Record<string, string>;
    },
    callback: (res: NodeIncomingMessage) => void,
  ): NodeClientRequest;
}

/** The Node `Buffer` constructor from the desktop (Electron) global scope. */
export function getNodeBuffer(): NodeBufferConstructor {
  return (window as unknown as { Buffer: NodeBufferConstructor }).Buffer;
}

/** The Node `process.env` object from the desktop (Electron) global scope. */
export function getNodeProcessEnv(): Record<string, string | undefined> {
  return (
    (window as unknown as { process?: { env?: Record<string, string | undefined> } })
      .process?.env ?? {}
  );
}
