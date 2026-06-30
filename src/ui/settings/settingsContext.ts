import type { LocalLlmHubPlugin } from "src/plugin";

export interface SettingsContext {
  plugin: LocalLlmHubPlugin;
  display: () => void;
}
