import { Setting } from "obsidian";
import { t } from "src/i18n";
import type { LocalLlmHubPlugin } from "src/plugin";

export function addWorkflowSettings(containerEl: HTMLElement, plugin: LocalLlmHubPlugin): void {
  new Setting(containerEl).setName(t("settings.workflow")).setHeading();

  // Toggle for workflow hotkeys
  new Setting(containerEl)
    .setName(t("settings.workflowHotkeys"))
    .setDesc(t("settings.workflowHotkeys.desc"))
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.enabledWorkflowHotkeys.length > 0)
        .setDisabled(true)
    );

  // Display registered hotkeys count
  if (plugin.settings.enabledWorkflowHotkeys.length > 0) {
    new Setting(containerEl)
      .setName(t("settings.registeredHotkeys"))
      .setDesc(
        t("settings.registeredHotkeys.desc", {
          count: plugin.settings.enabledWorkflowHotkeys.length,
        })
      );
  }

  // Event triggers section
  new Setting(containerEl)
    .setName(t("settings.workflowEventTriggers"))
    .setDesc(t("settings.workflowEventTriggers.desc"));

  // Display registered event triggers
  if (plugin.settings.enabledWorkflowEventTriggers.length > 0) {
    for (const trigger of plugin.settings.enabledWorkflowEventTriggers) {
      const workflowName = trigger.workflowId.split("#").pop() || trigger.workflowId;
      const eventsLabel = trigger.events.join(", ");
      const patternLabel = trigger.filePattern ? ` (${trigger.filePattern})` : "";

      new Setting(containerEl)
        .setName(workflowName)
        .setDesc(`${eventsLabel}${patternLabel}`)
        .addExtraButton((btn) =>
          btn
            .setIcon("trash")
            .setTooltip(t("settings.removeEventTrigger"))
            .onClick(() => {
              void (async () => {
                plugin.settings.enabledWorkflowEventTriggers =
                  plugin.settings.enabledWorkflowEventTriggers.filter(
                    (t) => t.workflowId !== trigger.workflowId
                  );
                await plugin.saveSettings();
                // Re-render by clearing and re-adding
                containerEl.empty();
                addWorkflowSettings(containerEl, plugin);
              })();
            })
        );
    }
  }
}
