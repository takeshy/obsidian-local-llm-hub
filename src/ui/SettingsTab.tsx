import { PluginSettingTab, App } from "obsidian";
import type { LocalLlmHubPlugin } from "src/plugin";
import { displayLlmSettings } from "src/ui/settings/llmSettings";
import { displayWorkspaceSettings } from "src/ui/settings/workspaceSettings";
import { displayRagSettings } from "src/ui/settings/ragSettings";
import { displayEncryptionSettings } from "src/ui/settings/encryptionSettings";
import { displaySlashCommandSettings } from "src/ui/settings/slashCommandSettings";

export class SettingsTab extends PluginSettingTab {
  plugin: LocalLlmHubPlugin;

  constructor(app: App, plugin: LocalLlmHubPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const ctx = {
      plugin: this.plugin,
      display: () => this.display(),
    };

    displayLlmSettings(containerEl, ctx);
    displayWorkspaceSettings(containerEl, ctx);
    displayRagSettings(containerEl, ctx);
    displaySlashCommandSettings(containerEl, ctx);
    displayEncryptionSettings(containerEl, ctx);
  }
}
