import { Setting, Notice } from "obsidian";
import { t } from "src/i18n";
import type { LocalLlmHubPlugin } from "src/plugin";
import { getRagStore } from "src/core/ragStore";
import { WORKSPACE_FOLDER } from "src/types";
import { fetchEmbeddingModels } from "src/core/localLlmProvider";

interface SettingsContext {
  plugin: LocalLlmHubPlugin;
  display: () => void;
}

export function displayRagSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin, display } = ctx;
  const ragConfig = plugin.settings.ragConfig;
  const updateRagConfig = async (patch: Partial<typeof plugin.settings.ragConfig>) => {
    plugin.settings.ragConfig = { ...plugin.settings.ragConfig, ...patch };
    await plugin.saveSettings();
  };

  new Setting(containerEl).setName(t("settings.rag")).setHeading();

  // Enable RAG
  new Setting(containerEl)
    .setName(t("settings.ragEnable"))
    .setDesc(t("settings.ragEnableDesc"))
    .addToggle((toggle) => {
      toggle
        .setValue(ragConfig.enabled)
        .onChange(async (value) => {
          await updateRagConfig({ enabled: value });
          display();
        });
    });

  if (!ragConfig.enabled) return;

  // Embedding server URL (optional override)
  new Setting(containerEl)
    .setName(t("settings.ragEmbeddingBaseUrl"))
    .setDesc(t("settings.ragEmbeddingBaseUrlDesc"))
    .addText((text) => {
      text
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setPlaceholder("http://localhost:8001")
        .setValue(ragConfig.embeddingBaseUrl || "")
        .onChange(async (value) => {
          await updateRagConfig({ embeddingBaseUrl: value || undefined });
        });
      text.inputEl.addClass("llm-hub-wide-input");
    });

  // Embedding model
  const embeddingModelSetting = new Setting(containerEl)
    .setName(t("settings.ragEmbeddingModel"))
    .setDesc(t("settings.ragEmbeddingModelDesc"));

  let embeddingDropdown: HTMLSelectElement | null = null;
  embeddingModelSetting.controlEl.createEl("select", {}, (select) => {
    embeddingDropdown = select;
    select.addClass("dropdown");
    if (!ragConfig.embeddingModel) {
      const placeholder = select.createEl("option", { text: t("settings.ragEmbeddingModelPlaceholder"), value: "" });
      placeholder.disabled = true;
      placeholder.selected = true;
    } else {
      const opt = select.createEl("option", { text: ragConfig.embeddingModel, value: ragConfig.embeddingModel });
      opt.selected = true;
    }
    select.addEventListener("change", () => {
      void updateRagConfig({ embeddingModel: select.value });
    });
  });

  embeddingModelSetting.addButton((btn) =>
    btn
      .setButtonText(t("settings.llmModal.fetchModels"))
      .onClick(async () => {
        btn.setButtonText(t("settings.llmModal.fetching"));
        btn.setDisabled(true);
        try {
          const models = await fetchEmbeddingModels(plugin.settings.llmConfig, plugin.settings.ragConfig.embeddingBaseUrl);
          if (models.length === 0) {
            new Notice(t("settings.llmModal.noModelsFound"));
            return;
          }
          if (embeddingDropdown) {
            embeddingDropdown.empty();
            for (const model of models) {
              const opt = embeddingDropdown.createEl("option", { text: model, value: model });
              if (model === ragConfig.embeddingModel) {
                opt.selected = true;
              }
            }
            if (!ragConfig.embeddingModel || !models.includes(ragConfig.embeddingModel)) {
              await updateRagConfig({ embeddingModel: models[0] });
              embeddingDropdown.value = models[0];
            }
          }
          new Notice(t("settings.llmModal.modelsLoaded", { count: String(models.length) }));
        } catch (err) {
          new Notice(`Error: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          btn.setButtonText(t("settings.llmModal.fetchModels"));
          btn.setDisabled(false);
        }
      })
  );

  // Target folders
  new Setting(containerEl)
    .setName(t("settings.ragTargetFolders"))
    .setDesc(t("settings.ragTargetFoldersDesc"))
    .addText((text) => {
      text
        .setValue(ragConfig.targetFolders.join(", "))
        .onChange(async (value) => {
          const folders = value.split(",").map(s => s.trim()).filter(Boolean);
          await updateRagConfig({ targetFolders: folders });
        });
      text.inputEl.addClass("llm-hub-wide-input");
    });

  // Exclude patterns
  new Setting(containerEl)
    .setName(t("settings.ragExcludePatterns"))
    .setDesc(t("settings.ragExcludePatternsDesc"))
    .addText((text) => {
      text
        .setValue(ragConfig.excludePatterns.join(", "))
        .onChange(async (value) => {
          const patterns = value.split(",").map(s => s.trim()).filter(Boolean);
          await updateRagConfig({ excludePatterns: patterns });
        });
      text.inputEl.addClass("llm-hub-wide-input");
    });

  // Chunk size
  new Setting(containerEl)
    .setName(t("settings.ragChunkSize"))
    .setDesc(t("settings.ragChunkSizeDesc"))
    .addText((text) => {
      text
        .setValue(String(ragConfig.chunkSize))
        .onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num > 0) {
            await updateRagConfig({ chunkSize: num });
          }
        });
      text.inputEl.type = "number";
      text.inputEl.min = "100";
      text.inputEl.step = "100";
    });

  // Top K
  new Setting(containerEl)
    .setName(t("settings.ragTopK"))
    .setDesc(t("settings.ragTopKDesc"))
    .addText((text) => {
      text
        .setValue(String(ragConfig.topK))
        .onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num > 0) {
            await updateRagConfig({ topK: num });
          }
        });
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.inputEl.max = "20";
      text.inputEl.step = "1";
    });

  // Status display
  const store = getRagStore();
  const status = store.getStatus();
  const statusSetting = new Setting(containerEl);

  if (status.totalChunks > 0) {
    statusSetting.setDesc(
      t("settings.ragStatus", {
        chunks: String(status.totalChunks),
        files: String(status.indexedFiles),
      })
    );
  } else {
    statusSetting.setDesc(t("settings.ragNoIndex"));
  }

  // Sync button
  statusSetting.addButton((btn) =>
    btn
      .setButtonText(t("settings.ragSync"))
      .setCta()
      .onClick(async () => {
        btn.setButtonText(t("settings.ragSyncing"));
        btn.setDisabled(true);
        try {
          const result = await store.sync(
            plugin.app,
            plugin.settings.ragConfig,
            plugin.settings.llmConfig,
            WORKSPACE_FOLDER,
          );
          new Notice(t("settings.ragSynced", {
            count: String(result.totalChunks),
            files: String(result.indexedFiles),
          }));
          display();
        } catch (err) {
          new Notice(t("settings.ragSyncFailed", {
            error: err instanceof Error ? err.message : String(err),
          }));
        } finally {
          btn.setButtonText(t("settings.ragSync"));
          btn.setDisabled(false);
        }
      })
  );

  // Clear button
  statusSetting.addButton((btn) =>
    btn
      .setButtonText(t("settings.ragClear"))
      .onClick(async () => {
        await store.clear(plugin.app, WORKSPACE_FOLDER);
        new Notice(t("settings.ragCleared"));
        display();
      })
  );
}
