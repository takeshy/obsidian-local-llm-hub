import { Notice, Setting } from "obsidian";
import { t } from "src/i18n";
import type { LocalLlmHubPlugin } from "src/plugin";
import { normalizeVaultScopePath } from "obsidian-llm-hub-common/core";

interface SettingsContext {
  plugin: LocalLlmHubPlugin;
}

export function displayChatSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin } = ctx;
  new Setting(containerEl)
    .setName(t("settings.manualChatSaveFolder"))
    .setDesc(t("settings.manualChatSaveFolderDesc"))
    .addText((text) => {
      text.setPlaceholder(t("settings.manualChatSaveFolderPlaceholder")).setValue(plugin.settings.manualChatSaveFolder);
      text.inputEl.addEventListener("blur", () => {
        void (async () => {
          const rawValue = text.inputEl.value.trim();
          const normalized = rawValue ? normalizeVaultScopePath(rawValue) : "";
          if (normalized === null) {
            new Notice(t("settings.manualChatSaveFolderInvalidPath"));
            text.inputEl.value = plugin.settings.manualChatSaveFolder;
            return;
          }
          plugin.settings.manualChatSaveFolder = normalized;
          text.inputEl.value = normalized;
          await plugin.saveSettings();
        })();
      });
    });
}
