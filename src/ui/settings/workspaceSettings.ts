import { Notice, Setting } from "obsidian";
import { t } from "src/i18n";
import type { LocalLlmHubPlugin } from "src/plugin";
import { normalizeVaultScopePath } from "src/core/vaultToolScope";

interface SettingsContext {
  plugin: LocalLlmHubPlugin;
  display: () => void;
}

export function displayWorkspaceSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin } = ctx;

  new Setting(containerEl).setName(t("settings.workspace")).setHeading();

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
    .setName(t("settings.vaultToolAllowedFolders"))
    .setDesc(t("settings.vaultToolAllowedFoldersDesc"))
    .addText((text) => {
      text
        .setPlaceholder(t("settings.vaultToolAllowedFoldersPlaceholder"))
        .setValue(plugin.settings.vaultToolAllowedFolders.join(", "));
      text.inputEl.addEventListener("blur", () => {
        void (async () => {
          const enteredFolders = text.inputEl.value
            .split(",")
            .map((folder) => folder.trim().replace(/\/+$/g, ""))
            .filter(Boolean);
          const normalizedFolders = enteredFolders.map(normalizeVaultScopePath);
          if (normalizedFolders.some((folder) => folder === null)) {
            new Notice(t("settings.vaultToolAllowedFoldersInvalid"));
            text.setValue(plugin.settings.vaultToolAllowedFolders.join(", "));
            return;
          }
          plugin.settings.vaultToolAllowedFolders = normalizedFolders.filter(
            (folder): folder is string => folder !== null,
          );
          text.setValue(plugin.settings.vaultToolAllowedFolders.join(", "));
          await plugin.saveSettings();
        })();
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
