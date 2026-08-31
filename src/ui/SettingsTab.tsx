import { PluginSettingTab, App, Setting, type SettingDefinitionItem } from "obsidian";
import type { LocalLlmHubPlugin } from "src/plugin";
import { displayLlmSettings } from "src/ui/settings/llmSettings";
import { displayWorkspaceSettings } from "src/ui/settings/workspaceSettings";
import { displayChatSettings } from "src/ui/settings/chatSettings";
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

  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.getSections().map(({ name, render }) => ({
      name,
      render: (setting: Setting) => {
        setting.settingEl.empty();
        setting.settingEl.addClass("llm-hub-settings-section");
        render(setting.settingEl);
      },
    }));
  }

  private getSections(): Array<{ name: string; render: (containerEl: HTMLElement) => void }> {
    const ctx = {
      plugin: this.plugin,
      display: () => this.update(),
    };

    const section = (name: string, render: (containerEl: HTMLElement) => void) => ({ name, render });

    return [
      section("Language models", containerEl => displayLlmSettings(containerEl, ctx)),
      section("Workspaces", containerEl => displayWorkspaceSettings(containerEl, ctx)),
      section("Chat", containerEl => displayChatSettings(containerEl, ctx)),
      section("Retrieval-augmented generation", containerEl => displayRagSettings(containerEl, ctx)),
      section("Knowledge", containerEl => displayKnowledgeSettings(containerEl, ctx)),
      section("External skills", containerEl => displayExternalSkillSettings(containerEl, ctx)),
      section("Agent plugins", containerEl => displayAgentPluginSettings(containerEl, ctx)),
      section("Slash commands", containerEl => displaySlashCommandSettings(containerEl, ctx)),
      section("Model Context Protocol", containerEl => displayMcpSettings(containerEl, ctx)),
      section("Encryption", containerEl => displayEncryptionSettings(containerEl, ctx)),
    ];
  }
}
