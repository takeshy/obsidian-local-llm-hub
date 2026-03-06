import { Modal } from "obsidian";
import type { App } from "obsidian";
import { t } from "src/i18n";

export function promptForPassword(app: App): Promise<string | null> {
  return new Promise((resolve) => {
    class PasswordModal extends Modal {
      onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h3", { text: t("crypt.enterPassword") });
        contentEl.createEl("p", { text: t("crypt.enterPasswordDesc") });

        const inputEl = contentEl.createEl("input", {
          type: "password",
          placeholder: t("crypt.passwordPlaceholder"),
          cls: "llm-hub-password-input",
        });

        const buttonContainer = contentEl.createDiv({ cls: "llm-hub-button-container" });

        buttonContainer.createEl("button", {
          text: t("common.cancel"),
        }).onclick = () => {
          this.close();
        };

        buttonContainer.createEl("button", {
          text: t("crypt.unlock"),
          cls: "mod-cta",
        }).onclick = () => {
          if (inputEl.value) {
            resolve(inputEl.value);
            this.close();
          }
        };

        inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && inputEl.value) {
            resolve(inputEl.value);
            this.close();
          }
        });

        setTimeout(() => inputEl.focus(), 50);
      }

      onClose(): void {
        resolve(null);
      }
    }

    new PasswordModal(app).open();
  });
}
