import { Setting, Notice } from "obsidian";
import { t } from "src/i18n";
import { SlashCommandModal } from "./SlashCommandModal";

interface SettingsContext {
  plugin: import("src/plugin").LocalLlmHubPlugin;
  display: () => void;
}

export function displaySlashCommandSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin, display } = ctx;
  const app = plugin.app;

  new Setting(containerEl).setName(t("settings.slashCommands")).setHeading();

  new Setting(containerEl)
    .setName(t("settings.manageCommands"))
    .setDesc(t("settings.manageCommands.desc"))
    .addButton((btn) =>
      btn
        .setButtonText(t("settings.addCommand"))
        .setCta()
        .onClick(() => {
          new SlashCommandModal(
            app,
            null,
            async (command) => {
              plugin.settings.slashCommands.push(command);
              await plugin.saveSettings();
              display();
              new Notice(t("settings.commandCreated", { name: command.name }));
            }
          ).open();
        })
    );

  if (plugin.settings.slashCommands.length > 0) {
    for (const command of plugin.settings.slashCommands) {
      const commandSetting = new Setting(containerEl)
        .setName(`/${command.name}`)
        .setDesc(
          command.description ||
            command.promptTemplate.slice(0, 50) +
              (command.promptTemplate.length > 50 ? "..." : "")
        );

      commandSetting.addExtraButton((btn) => {
        btn
          .setIcon("pencil")
          .setTooltip(t("settings.editCommand"))
          .onClick(() => {
            new SlashCommandModal(
              app,
              command,
              async (updated) => {
                const index = plugin.settings.slashCommands.findIndex(
                  (c) => c.id === command.id
                );
                if (index >= 0) {
                  plugin.settings.slashCommands[index] = updated;
                  await plugin.saveSettings();
                  display();
                  new Notice(t("settings.commandUpdated", { name: updated.name }));
                }
              }
            ).open();
          });
      });

      commandSetting.addExtraButton((btn) => {
        btn
          .setIcon("trash")
          .setTooltip(t("settings.deleteCommand"))
          .onClick(() => {
            void (async () => {
              plugin.settings.slashCommands =
                plugin.settings.slashCommands.filter(
                  (c) => c.id !== command.id
                );
              await plugin.saveSettings();
              display();
              new Notice(t("settings.commandDeleted", { name: command.name }));
            })();
          });
      });
    }
  }
}
