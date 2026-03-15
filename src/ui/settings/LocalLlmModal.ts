import { Modal, App, Setting, Notice } from "obsidian";
import { fetchLocalLlmModels } from "src/core/localLlmProvider";
import { t } from "src/i18n";
import type { LocalLlmConfig, LlmFramework } from "src/types";

export class LocalLlmModal extends Modal {
  private config: LocalLlmConfig;
  private onSave: (config: LocalLlmConfig, models: string[]) => void | Promise<void>;
  private fetchedModels: string[] = [];
  private modelsFetched = false;
  private saveButton: HTMLButtonElement | null = null;

  constructor(
    app: App,
    currentConfig: LocalLlmConfig,
    existingModels: string[],
    onSave: (config: LocalLlmConfig, models: string[]) => void | Promise<void>,
  ) {
    super(app);
    this.config = { ...currentConfig };
    this.onSave = onSave;
    // If models were already fetched previously, pre-populate
    if (existingModels.length > 0) {
      this.fetchedModels = [...existingModels];
      this.modelsFetched = true;
    }
  }

  onOpen() {
    this.display();
  }

  private display() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-hub-modal");
    contentEl.createEl("h2", { text: t("settings.llmModal.title") });

    const descEl = contentEl.createDiv({ cls: "llm-hub-modal-desc" });
    descEl.textContent = t("settings.llmModal.desc");

    // Framework
    const frameworkDefaults: Record<LlmFramework, string> = {
      ollama: "http://localhost:11434",
      "lm-studio": "http://localhost:1234",
      anythingllm: "http://localhost:3001/api",
      vllm: "http://localhost:8000",
    };

    const baseUrlInput = { el: null as HTMLInputElement | null };

    new Setting(contentEl)
      .setName(t("settings.llmModal.framework"))
      .setDesc(t("settings.llmModal.frameworkDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("ollama", "Ollama")
          .addOption("lm-studio", "Lm studio")
          .addOption("anythingllm", "AnythingLLM")
          .addOption("vllm", "vLLM")
          .setValue(this.config.framework)
          .onChange((value) => {
            const fw = value as LlmFramework;
            this.config.framework = fw;
            // Reset fetch state when framework changes
            this.modelsFetched = false;
            this.fetchedModels = [];
            this.display();
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
            // Reset fetch state when URL changes
            this.modelsFetched = false;
            this.fetchedModels = [];
            this.updateSaveButton();
          });
        text.inputEl.addClass("llm-hub-wide-input");
        baseUrlInput.el = text.inputEl;
      });

    // API Key (optional)
    new Setting(contentEl)
      .setName(t("settings.llmModal.apiKey"))
      .setDesc(this.config.framework === "anythingllm"
        ? t("settings.llmModal.apiKeyDescAnythingllm")
        : t("settings.llmModal.apiKeyDesc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.llmModal.apiKeyPlaceholder"))
          .setValue(this.config.apiKey || "")
          .onChange((value) => {
            this.config.apiKey = value || undefined;
          });
        text.inputEl.type = "password";
      });

    // Fetch models button
    const fetchSetting = new Setting(contentEl)
      .setName(t("settings.llmModal.model"))
      .setDesc(t("settings.llmModal.modelDesc"));

    const fetchStatusEl = fetchSetting.controlEl.createDiv({ cls: "llm-hub-status" });
    if (this.modelsFetched) {
      fetchStatusEl.addClass("llm-hub-status--success");
      fetchStatusEl.textContent = t("settings.llmModal.modelsLoaded").replace("{{count}}", String(this.fetchedModels.length));
    }

    fetchSetting.addButton((btn) =>
      btn
        .setButtonText(t("settings.llmModal.fetchModels"))
        .onClick(async () => {
          fetchStatusEl.empty();
          fetchStatusEl.removeClass("llm-hub-status--success", "llm-hub-status--error");
          btn.setButtonText(t("settings.llmModal.fetching"));
          btn.setDisabled(true);
          try {
            const models = await fetchLocalLlmModels(this.config);
            if (models.length === 0) {
              fetchStatusEl.addClass("llm-hub-status--error");
              fetchStatusEl.textContent = t("settings.llmModal.noModelsFound");
              return;
            }
            this.fetchedModels = models;
            this.modelsFetched = true;
            if (!this.config.model || !models.includes(this.config.model)) {
              this.config.model = models[0];
            }
            this.updateSaveButton();
            fetchStatusEl.addClass("llm-hub-status--success");
            fetchStatusEl.textContent = t("settings.llmModal.modelsLoaded").replace("{{count}}", String(models.length));
          } catch (err) {
            fetchStatusEl.addClass("llm-hub-status--error");
            fetchStatusEl.textContent = err instanceof Error ? err.message : String(err);
          } finally {
            btn.setButtonText(t("settings.llmModal.fetchModels"));
            btn.setDisabled(false);
          }
        })
    );

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

    // Save / Cancel
    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(t("common.cancel")).onClick(() => {
          this.close();
        })
      )
      .addButton((btn) => {
        this.saveButton = btn.buttonEl;
        btn
          .setButtonText(t("common.save"))
          .setCta()
          .onClick(() => {
            if (!this.config.baseUrl.trim()) {
              new Notice(t("settings.llmModal.baseUrlRequired"));
              return;
            }
            if (!this.modelsFetched) {
              new Notice(t("settings.llmModal.fetchRequired"));
              return;
            }
            void this.onSave(this.config, this.fetchedModels);
            this.close();
          });
        this.updateSaveButton();
      });
  }

  private updateSaveButton() {
    if (this.saveButton) {
      this.saveButton.disabled = !this.modelsFetched;
      this.saveButton.toggleClass("is-disabled", !this.modelsFetched);
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
