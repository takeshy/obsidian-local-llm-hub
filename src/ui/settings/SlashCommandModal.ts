import { Modal, App, Setting, Notice } from "obsidian";
import type { SlashCommand } from "src/types";
import { t } from "src/i18n";

export class SlashCommandModal extends Modal {
  private command: SlashCommand;
  private isNew: boolean;
  private onSubmit: (command: SlashCommand) => void | Promise<void>;

  constructor(
    app: App,
    command: SlashCommand | null,
    onSubmit: (command: SlashCommand) => void | Promise<void>
  ) {
    super(app);
    this.isNew = command === null;
    this.command = command
      ? { ...command }
      : {
          id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          name: "",
          promptTemplate: "",
          description: "",
        };
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", {
      text: this.isNew ? t("settings.createSlashCommand") : t("settings.editSlashCommand"),
    });

    // Command name
    new Setting(contentEl)
      .setName(t("settings.commandName"))
      .setDesc(t("settings.commandName.desc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.commandName.placeholder"))
          .setValue(this.command.name)
          .onChange((value) => {
            this.command.name = value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
          });
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
          }
        });
      });

    // Description
    new Setting(contentEl)
      .setName(t("settings.description"))
      .setDesc(t("settings.description.desc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.description.placeholder"))
          .setValue(this.command.description || "")
          .onChange((value) => {
            this.command.description = value;
          });
      });

    // Prompt template
    const promptSetting = new Setting(contentEl)
      .setName(t("settings.promptTemplate"))
      .setDesc(t("settings.promptTemplate.desc"));

    promptSetting.settingEl.addClass("llm-hub-settings-textarea-container");

    promptSetting.addTextArea((text) => {
      text
        .setPlaceholder(t("settings.promptTemplate.placeholder"))
        .setValue(this.command.promptTemplate)
        .onChange((value) => {
          this.command.promptTemplate = value;
        });
      text.inputEl.rows = 6;
      text.inputEl.addClass("llm-hub-settings-textarea");
    });

    // Action buttons
    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(t("common.cancel")).onClick(() => this.close())
      )
      .addButton((btn) =>
        btn
          .setButtonText(this.isNew ? t("common.create") : t("common.save"))
          .setCta()
          .onClick(() => {
            if (!this.command.name.trim()) {
              new Notice(t("settings.commandName.required"));
              return;
            }
            if (!this.command.promptTemplate.trim()) {
              new Notice(t("settings.promptTemplate.required"));
              return;
            }
            void this.onSubmit(this.command);
            this.close();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
