import { Setting } from "obsidian";
import { t } from "src/i18n";
import type { LocalLlmHubPlugin } from "src/plugin";

interface SettingsContext {
  plugin: LocalLlmHubPlugin;
  display: () => void;
}

export function displayWorkspaceSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin } = ctx;

  new Setting(containerEl).setName(t("settings.workspace")).setHeading();

  new Setting(containerEl)
    .setName(t("settings.workspaceFolder"))
    .setDesc(t("settings.workspaceFolderDesc"))
    .addText((text) => {
      text
        .setPlaceholder("LocalLlmHub")
        .setValue(plugin.settings.workspaceFolder)
        .onChange(async (value) => {
          plugin.settings.workspaceFolder = value || "LocalLlmHub";
          await plugin.saveSettings();
        });
    });

  new Setting(containerEl)
    .setName(t("settings.skillsFolder"))
    .setDesc(t("settings.skillsFolderDesc"))
    .addText((text) => {
      text
        .setPlaceholder("Skills")
        .setValue(plugin.settings.skillsFolderPath)
        .onChange(async (value) => {
          plugin.settings.skillsFolderPath = value || "skills";
          await plugin.saveSettings();
        });
    });

  new Setting(containerEl)
    .setName(t("settings.hideWorkspaceFolder"))
    .setDesc(t("settings.hideWorkspaceFolderDesc"))
    .addToggle((toggle) => {
      toggle
        .setValue(plugin.settings.hideWorkspaceFolder)
        .onChange(async (value) => {
          plugin.settings.hideWorkspaceFolder = value;
          await plugin.saveSettings();
        });
    });

  new Setting(containerEl)
    .setName(t("settings.saveChatHistory"))
    .setDesc(t("settings.saveChatHistoryDesc"))
    .addToggle((toggle) => {
      toggle
        .setValue(plugin.settings.saveChatHistory)
        .onChange(async (value) => {
          plugin.settings.saveChatHistory = value;
          await plugin.saveSettings();
        });
    });

  new Setting(containerEl)
    .setName(t("settings.systemPrompt"))
    .setDesc(t("settings.systemPromptDesc"))
    .addTextArea((text) => {
      text
        .setPlaceholder(t("settings.systemPromptPlaceholder"))
        .setValue(plugin.settings.systemPrompt)
        .onChange(async (value) => {
          plugin.settings.systemPrompt = value;
          await plugin.saveSettings();
        });
      text.inputEl.rows = 3;
      text.inputEl.addClass("llm-hub-wide-input");
    });
}
