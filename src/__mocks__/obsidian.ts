// Minimal obsidian mock for unit tests
export class App {}
export class TFile {
  path = "";
  name = "";
  extension = "";
  basename = "";
}
export function requestUrl(_options: unknown): Promise<unknown> {
  throw new Error("requestUrl is not available in tests");
}
