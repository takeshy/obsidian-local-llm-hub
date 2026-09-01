import { App, Modal, Notice, Setting } from "obsidian";
import { t } from "src/i18n";

export class LlmProfileNameModal extends Modal {
  private name: string;

  constructor(
    app: App,
    private readonly modalTitle: string,
    initialValue: string,
    private readonly onSubmit: (name: string) => void | Promise<void>,
  ) {
    super(app);
    this.name = initialValue;
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: this.modalTitle });
    new Setting(this.contentEl)
      .setName(t("settings.llmProfileName"))
      .addText(text => {
        text
          .setPlaceholder(t("settings.llmProfileNamePlaceholder"))
          .setValue(this.name)
          .onChange(value => { this.name = value; });
        text.inputEl.addEventListener("keydown", event => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.submit();
          }
        });
        text.inputEl.focus();
      });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton(button => button.setButtonText("OK").setCta().onClick(() => this.submit()));
  }

  private submit(): void {
    const name = this.name.trim();
    if (!name) {
      new Notice(t("settings.llmProfileNameEmpty"));
      return;
    }
    void this.onSubmit(name);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
