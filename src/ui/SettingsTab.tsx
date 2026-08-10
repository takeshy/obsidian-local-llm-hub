import { PluginSettingTab, App } from "obsidian";
import type { LocalLlmHubPlugin } from "src/plugin";
import { displayLlmSettings } from "src/ui/settings/llmSettings";
import { displayWorkspaceSettings } from "src/ui/settings/workspaceSettings";
import { displayRagSettings } from "src/ui/settings/ragSettings";
import { displayKnowledgeSettings } from "src/ui/settings/knowledgeSettings";
import { displayExternalSkillSettings } from "src/ui/settings/externalSkillSettings";
import { displayEncryptionSettings } from "src/ui/settings/encryptionSettings";
import { displaySlashCommandSettings } from "src/ui/settings/slashCommandSettings";
import { displayMcpSettings } from "src/ui/settings/mcpSettings";
import { displayAgentPluginSettings } from "src/ui/settings/agentPluginSettings";

export class SettingsTab extends PluginSettingTab {
  plugin: LocalLlmHubPlugin;

  constructor(app: App, plugin: LocalLlmHubPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Render settings using the API available at the declared minimum version. */
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
    displayKnowledgeSettings(containerEl, ctx);
    displayExternalSkillSettings(containerEl, ctx);
    displayAgentPluginSettings(containerEl, ctx);
    displaySlashCommandSettings(containerEl, ctx);
    displayMcpSettings(containerEl, ctx);
    displayEncryptionSettings(containerEl, ctx);
  }
}
