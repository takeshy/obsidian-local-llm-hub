import { Setting, Notice } from "obsidian";
import { verifyLocalLlm } from "src/core/localLlmProvider";
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
  } else {
    setting.addButton((button) =>
      button
        .setButtonText(t("settings.verify"))
        .setCta()
        .onClick(async () => {
          statusEl.empty();
          statusEl.removeClass("llm-hub-status--success", "llm-hub-status--error");
          statusEl.setText(t("settings.llmVerifying"));

          try {
            const result = await verifyLocalLlm(llmConfig);

            if (!result.success) {
              statusEl.addClass("llm-hub-status--error");
              plugin.settings.llmVerified = false;
              await plugin.saveSettings();
              statusEl.empty();
              statusEl.createEl("strong", { text: t("settings.llmConnectionFailed") });
              statusEl.createSpan({ text: result.error || "" });
              return;
            }

            if (!llmConfig.model) {
              statusEl.addClass("llm-hub-status--error");
              statusEl.empty();
              statusEl.createEl("strong", { text: t("settings.llmNoModel") });
              return;
            }

            plugin.settings.llmVerified = true;
            await plugin.saveSettings();
            display();
            new Notice(t("settings.llmVerified"));
          } catch (err) {
            plugin.settings.llmVerified = false;
            await plugin.saveSettings();
            statusEl.addClass("llm-hub-status--error");
            statusEl.empty();
            statusEl.createEl("strong", { text: t("common.error") });
            statusEl.createSpan({ text: String(err) });
          }
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
          async (config) => {
            let verified = false;
            if (config.model && config.baseUrl) {
              try {
                const result = await verifyLocalLlm(config);
                verified = result.success;
              } catch { /* ignore */ }
            }
            plugin.settings.llmConfig = config;
            plugin.settings.llmVerified = verified;
            await plugin.saveSettings();
            display();
            new Notice(verified ? t("settings.llmVerified") : t("settings.llmConfigSaved"));
          },
        ).open();
      })
  );
}
