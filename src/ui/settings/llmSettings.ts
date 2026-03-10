import { Setting, Notice } from "obsidian";
import { t } from "src/i18n";
import { DEFAULT_LOCAL_LLM_CONFIG } from "src/types";
import { LocalLlmModal } from "./LocalLlmModal";
import type { LocalLlmHubPlugin } from "src/plugin";

interface SettingsContext {
  plugin: LocalLlmHubPlugin;
  display: () => void;
}

export function displayLlmSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin, display } = ctx;
  const app = plugin.app;
  const llmConfig = plugin.settings.llmConfig || DEFAULT_LOCAL_LLM_CONFIG;

  new Setting(containerEl).setName(t("settings.llm")).setHeading();

  const modelInfo = llmConfig.model ? ` (${llmConfig.model})` : "";
  const setting = new Setting(containerEl)
    .setName(`Local LLM${modelInfo}`)
    .setDesc(t("settings.llmDesc"));

  const statusEl = setting.controlEl.createDiv({ cls: "llm-hub-status" });

  if (plugin.settings.llmVerified) {
    statusEl.addClass("llm-hub-status--success");
    statusEl.textContent = t("settings.verified");
    setting.addButton((button) =>
      button
        .setButtonText(t("settings.disable"))
        .onClick(async () => {
          plugin.settings.llmVerified = false;
          await plugin.saveSettings();
          display();
          new Notice(t("settings.llmDisabled"));
        })
    );
  }

  setting.addExtraButton((button) =>
    button
      .setIcon("settings")
      .setTooltip(t("settings.llmConfigure"))
      .onClick(() => {
        new LocalLlmModal(
          app,
          llmConfig,
          plugin.settings.availableModels || [],
          async (config, models) => {
            plugin.settings.llmConfig = config;
            plugin.settings.availableModels = models;
            plugin.settings.llmVerified = models.length > 0 && !!config.model;
            await plugin.saveSettings();
            display();
            new Notice(t("settings.llmVerified"));
          },
        ).open();
      })
  );
}
