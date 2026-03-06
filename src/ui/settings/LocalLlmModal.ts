import { Modal, App, Setting, Notice } from "obsidian";
import { verifyLocalLlm, fetchLocalLlmModels } from "src/core/localLlmProvider";
import { t } from "src/i18n";
import type { LocalLlmConfig, LlmFramework } from "src/types";

export class LocalLlmModal extends Modal {
  private config: LocalLlmConfig;
  private onSave: (config: LocalLlmConfig) => void | Promise<void>;
  private modelDropdown: HTMLSelectElement | null = null;

  constructor(
    app: App,
    currentConfig: LocalLlmConfig,
    onSave: (config: LocalLlmConfig) => void | Promise<void>,
  ) {
    super(app);
    this.config = { ...currentConfig };
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("llm-hub-modal");
    contentEl.createEl("h2", { text: t("settings.llmModal.title") });

    const descEl = contentEl.createDiv({ cls: "llm-hub-modal-desc" });
    descEl.textContent = t("settings.llmModal.desc");

    // Framework
    const frameworkDefaults: Record<LlmFramework, string> = {
      ollama: "http://localhost:11434",
      "lm-studio": "http://localhost:1234",
      vllm: "http://localhost:8000",
      other: "http://localhost:8080",
    };

    const baseUrlInput = { el: null as HTMLInputElement | null };

    new Setting(contentEl)
      .setName(t("settings.llmModal.framework"))
      .setDesc(t("settings.llmModal.frameworkDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("ollama", "Ollama")
          .addOption("lm-studio", "LM Studio") // eslint-disable-line obsidianmd/ui/sentence-case -- proper noun
          .addOption("vllm", "vLLM")  
          .addOption("other", t("settings.llmModal.frameworkOther"))
          .setValue(this.config.framework)
          .onChange((value) => {
            const fw = value as LlmFramework;
            this.config.framework = fw;
            // Update base URL placeholder
            if (baseUrlInput.el) {
              baseUrlInput.el.placeholder = frameworkDefaults[fw];
            }
          });
      });

    // Base URL
    new Setting(contentEl)
      .setName(t("settings.llmModal.baseUrl"))
      .setDesc(t("settings.llmModal.baseUrlDesc"))
      .addText((text) => {
        text
          .setPlaceholder(frameworkDefaults[this.config.framework])
          .setValue(this.config.baseUrl)
          .onChange((value) => {
            this.config.baseUrl = value;
          });
        text.inputEl.addClass("llm-hub-wide-input");
        baseUrlInput.el = text.inputEl;
      });

    // API Key (optional)
    new Setting(contentEl)
      .setName(t("settings.llmModal.apiKey"))
      .setDesc(t("settings.llmModal.apiKeyDesc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.llmModal.apiKeyPlaceholder"))
          .setValue(this.config.apiKey || "")
          .onChange((value) => {
            this.config.apiKey = value || undefined;
          });
        text.inputEl.type = "password";
      });

    // Model name with fetch button
    const modelSetting = new Setting(contentEl)
      .setName(t("settings.llmModal.model"))
      .setDesc(t("settings.llmModal.modelDesc"));

    modelSetting.controlEl.createEl("select", {}, (select) => {
      this.modelDropdown = select;
      select.addClass("dropdown");
      if (this.config.model) {
        const opt = select.createEl("option", { text: this.config.model, value: this.config.model });
        opt.selected = true;
      }
      select.addEventListener("change", () => {
        this.config.model = select.value;
      });
    });

    modelSetting.addButton((btn) =>
      btn
        .setButtonText(t("settings.llmModal.fetchModels"))
        .onClick(async () => {
          btn.setButtonText(t("settings.llmModal.fetching"));
          btn.setDisabled(true);
          try {
            const models = await fetchLocalLlmModels(this.config);
            if (models.length === 0) {
              new Notice(t("settings.llmModal.noModelsFound"));
              return;
            }
            if (this.modelDropdown) {
              this.modelDropdown.empty();
              for (const model of models) {
                const opt = this.modelDropdown.createEl("option", { text: model, value: model });
                if (model === this.config.model) {
                  opt.selected = true;
                }
              }
              if (!this.config.model || !models.includes(this.config.model)) {
                this.config.model = models[0];
                this.modelDropdown.value = models[0];
              }
            }
            new Notice(t("settings.llmModal.modelsLoaded").replace("{{count}}", String(models.length)));
          } catch (err) {
            new Notice(`Error: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            btn.setButtonText(t("settings.llmModal.fetchModels"));
            btn.setDisabled(false);
          }
        })
    );

    modelSetting.addText((text) => {
      text
        .setPlaceholder(t("settings.llmModal.modelPlaceholder"))
        .setValue(this.config.model)
        .onChange((value) => {
          this.config.model = value;
        });
    });

    // Temperature
    new Setting(contentEl)
      .setName(t("settings.llmModal.temperature"))
      .setDesc(t("settings.llmModal.temperatureDesc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.llmModal.serverDefault"))
          .setValue(this.config.temperature != null ? String(this.config.temperature) : "")
          .onChange((value) => {
            const trimmed = value.trim();
            this.config.temperature = trimmed ? parseFloat(trimmed) : undefined;
          });
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.max = "2";
        text.inputEl.step = "0.1";
      });

    // Max tokens
    new Setting(contentEl)
      .setName(t("settings.llmModal.maxTokens"))
      .setDesc(t("settings.llmModal.maxTokensDesc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.llmModal.serverDefault"))
          .setValue(this.config.maxTokens != null ? String(this.config.maxTokens) : "")
          .onChange((value) => {
            const trimmed = value.trim();
            this.config.maxTokens = trimmed ? parseInt(trimmed, 10) : undefined;
          });
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.step = "1";
      });

    // Test connection button
    const testSetting = new Setting(contentEl);
    const testStatusEl = testSetting.controlEl.createDiv({ cls: "llm-hub-status" });

    testSetting.addButton((btn) =>
      btn
        .setButtonText(t("settings.llmModal.testConnection"))
        .onClick(async () => {
          testStatusEl.empty();
          testStatusEl.removeClass("llm-hub-status--success", "llm-hub-status--error");
          btn.setButtonText(t("settings.llmModal.testing"));
          btn.setDisabled(true);

          try {
            const result = await verifyLocalLlm(this.config);
            if (result.success) {
              testStatusEl.addClass("llm-hub-status--success");
              testStatusEl.textContent = t("settings.llmModal.connectionSuccess");
            } else {
              testStatusEl.addClass("llm-hub-status--error");
              testStatusEl.textContent = result.error || t("settings.llmModal.connectionFailed");
            }
          } catch (err) {
            testStatusEl.addClass("llm-hub-status--error");
            testStatusEl.textContent = err instanceof Error ? err.message : String(err);
          } finally {
            btn.setButtonText(t("settings.llmModal.testConnection"));
            btn.setDisabled(false);
          }
        })
    );

    // Save / Cancel
    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(t("common.cancel")).onClick(() => {
          this.close();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText(t("common.save"))
          .setCta()
          .onClick(() => {
            if (!this.config.baseUrl.trim()) {
              new Notice(t("settings.llmModal.baseUrlRequired"));
              return;
            }
            void this.onSave(this.config);
            this.close();
          })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
