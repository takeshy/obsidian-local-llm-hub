import { PluginSettingTab, App, Setting, type SettingDefinitionItem } from "obsidian";
import type { LocalLlmHubPlugin } from "src/plugin";
import { t } from "src/i18n";
import { displayLlmSettings } from "src/ui/settings/llmSettings";
import { displayWorkspaceSettings } from "src/ui/settings/workspaceSettings";
import { displayRagSettings } from "src/ui/settings/ragSettings";
import { displayKnowledgeSettings } from "src/ui/settings/knowledgeSettings";
import { displayExternalSkillSettings } from "src/ui/settings/externalSkillSettings";
import { displayEncryptionSettings } from "src/ui/settings/encryptionSettings";
import { displaySlashCommandSettings } from "src/ui/settings/slashCommandSettings";
import { displayMcpSettings } from "src/ui/settings/mcpSettings";

export class SettingsTab extends PluginSettingTab {
  plugin: LocalLlmHubPlugin;

  constructor(app: App, plugin: LocalLlmHubPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const ctx = {
      plugin: this.plugin,
      display: () => this.update(),
    };
    const renderSection = (
      displaySection: (containerEl: HTMLElement, context: typeof ctx) => void,
    ) => (setting: Setting): void => {
      setting.settingEl.empty();
      setting.settingEl.addClass("llm-hub-settings-section");
      displaySection(setting.settingEl, ctx);
    };

    return [
      {
        name: t("settings.llm"),
        aliases: ["Model", "Provider", "Ollama", "LM Studio", "AnythingLLM"],
        render: renderSection(displayLlmSettings),
      },
      {
        name: t("settings.workspace"),
        aliases: [
          t("settings.hideWorkspaceFolder"),
          t("settings.saveChatHistory"),
          t("settings.systemPrompt"),
        ],
        render: renderSection(displayWorkspaceSettings),
      },
      {
        name: t("settings.rag"),
        aliases: [
          t("settings.ragEmbeddingModel"),
          t("settings.ragEmbeddingBaseUrl"),
          t("settings.ragExternalIndexPath"),
          t("settings.ragTargetFolders"),
          t("settings.ragExcludePatterns"),
          t("settings.ragChunkStrategy"),
          t("settings.ragChunkSize"),
          t("settings.ragChunkOverlap"),
          t("settings.ragTopK"),
          t("settings.ragMinScore"),
        ],
        render: renderSection(displayRagSettings),
      },
      {
        name: t("settings.knowledge"),
        aliases: [t("settings.okfSource"), t("settings.okfSourcePath")],
        render: renderSection(displayKnowledgeSettings),
      },
      {
        name: t("settings.externalSkills"),
        aliases: [
          t("settings.externalSkillsRepository"),
          t("settings.externalSkills.install"),
          t("settings.externalSkills.installed"),
        ],
        render: renderSection(displayExternalSkillSettings),
      },
      {
        name: t("settings.slashCommands"),
        aliases: [
          t("settings.manageCommands"),
          t("settings.commandName"),
          t("settings.promptTemplate"),
          t("settings.commandVaultToolMode"),
        ],
        render: renderSection(displaySlashCommandSettings),
      },
      {
        name: t("settings.mcp"),
        aliases: [
          t("settings.mcpServerName"),
          t("settings.mcpCommand"),
          t("settings.mcpArgs"),
          t("settings.mcpFraming"),
          t("settings.mcpEnv"),
        ],
        render: renderSection(displayMcpSettings),
      },
      {
        name: t("settings.encryption"),
        aliases: [
          t("settings.encryptionPassword"),
          t("settings.encryptChatHistory"),
          t("settings.encryptWorkflowHistory"),
          t("settings.encryptionResetKeys"),
        ],
        render: renderSection(displayEncryptionSettings),
      },
    ];
  }

}
