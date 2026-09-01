import { Setting, Notice } from "obsidian";
import { t } from "src/i18n";
import { DEFAULT_LOCAL_LLM_CONFIG } from "src/types";
import { LocalLlmModal } from "./LocalLlmModal";
import { LlmProfileNameModal } from "./LlmProfileNameModal";
import { ConfirmModal } from "src/ui/components/ConfirmModal";
import type { LocalLlmHubPlugin } from "src/plugin";

interface SettingsContext {
  plugin: LocalLlmHubPlugin;
  display: () => void;
}

export function displayLlmSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin, display } = ctx;
  const app = plugin.app;
  const llmConfig = plugin.settings.llmConfig || DEFAULT_LOCAL_LLM_CONFIG;
  const profileNames = Object.keys(plugin.settings.llmProfiles);
  const selectedProfile = plugin.settings.selectedLlmProfile;

  new Setting(containerEl).setName(t("settings.llm")).setHeading();

  const selector = new Setting(containerEl)
    .setName(t("settings.llmProfile"))
    .setDesc(t("settings.llmProfileDesc"));

  selector.addDropdown(dropdown => {
    for (const name of profileNames) dropdown.addOption(name, name);
    dropdown.setValue(selectedProfile).onChange(name => {
      void plugin.selectLlmProfile(name).then(display);
    });
  });
  selector.addExtraButton(button => button
    .setIcon("plus")
    .setTooltip(t("settings.createLlmProfile"))
    .onClick(() => {
      new LlmProfileNameModal(app, t("settings.createLlmProfile"), "", async name => {
        try {
          await plugin.createLlmProfile(name);
          display();
          new Notice(t("settings.llmProfileCreated", { name }));
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      }).open();
    }));

  const modelInfo = llmConfig.model ? ` (${llmConfig.model})` : "";
  const setting = new Setting(containerEl)
    .setName(`${selectedProfile}${modelInfo}`)
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

  setting.addExtraButton(button => button
    .setIcon("pencil")
    .setTooltip(t("settings.renameLlmProfile"))
    .onClick(() => {
      new LlmProfileNameModal(app, t("settings.renameLlmProfile"), selectedProfile, async name => {
        try {
          await plugin.renameLlmProfile(selectedProfile, name);
          display();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      }).open();
    }));

  setting.addExtraButton(button => button
    .setIcon("trash")
    .setTooltip(t("settings.deleteLlmProfile"))
    .setDisabled(profileNames.length <= 1)
    .onClick(() => {
      void (async () => {
        const confirmed = await new ConfirmModal(
          app,
          t("settings.deleteLlmProfileConfirm", { name: selectedProfile }),
          t("settings.deleteLlmProfile"),
        ).openAndWait();
        if (!confirmed) return;
        try {
          await plugin.deleteLlmProfile(selectedProfile);
          display();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      })();
    }));
}
