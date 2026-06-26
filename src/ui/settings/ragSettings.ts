import { Setting, Notice, Modal } from "obsidian";
import { t } from "src/i18n";
import type { LocalLlmHubPlugin } from "src/plugin";
import type { RagSetting, ChunkStrategy } from "src/types";
import { DEFAULT_RAG_SETTING } from "src/types";
import { getRagStore } from "src/core/ragStore";
import { deleteRagIndex } from "src/core/ragStorage";
import { fetchEmbeddingModels } from "src/core/localLlmProvider";
import { RagSettingNameModal } from "./RagSettingNameModal";

interface SettingsContext {
  plugin: LocalLlmHubPlugin;
  display: () => void;
}

const EMBEDDING_BASE_URL_PLACEHOLDER = "http://localhost:8001";
type RagSettingMode = "internal" | "combined" | "external";

function effectiveEmbeddingBaseUrl(plugin: LocalLlmHubPlugin, setting: RagSetting): string {
  return (setting.embeddingBaseUrl || plugin.settings.llmConfig.baseUrl).replace(/\/+$/, "");
}

function effectiveEmbeddingModel(setting: RagSetting): string {
  return setting.embeddingModel || DEFAULT_RAG_SETTING.embeddingModel;
}

function hasSameEffectiveEmbeddingConfig(
  plugin: LocalLlmHubPlugin,
  a: RagSetting,
  b: RagSetting,
): boolean {
  return effectiveEmbeddingBaseUrl(plugin, a) === effectiveEmbeddingBaseUrl(plugin, b) &&
    effectiveEmbeddingModel(a) === effectiveEmbeddingModel(b);
}

function isStandaloneInternalRag(setting: RagSetting): boolean {
  return !setting.externalIndexPath && setting.sourceRagSettings.length === 0;
}

export function displayRagSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin, display } = ctx;

  new Setting(containerEl).setName(t("settings.rag")).setHeading();

  // --- Setting selector dropdown + create button ---
  const settingNames = plugin.getRagSettingNames();
  const selectedName = plugin.getSelectedRagSettingName();

  const selectorSetting = new Setting(containerEl)
    .setName(t("settings.ragSetting"))
    .setDesc(t("settings.ragSettingDesc"));

  selectorSetting.controlEl.createEl("select", {}, (select) => {
    select.addClass("dropdown");

    // "None" option
    const noneOpt = select.createEl("option", { text: t("settings.ragNone"), value: "" });
    if (!selectedName) noneOpt.selected = true;

    for (const name of settingNames) {
      const opt = select.createEl("option", { text: name, value: name });
      if (name === selectedName) opt.selected = true;
    }

    select.addEventListener("change", () => {
      void (async () => {
        await plugin.selectRagSetting(select.value || null);
        display();
      })();
    });
  });

  // Create button
  selectorSetting.addExtraButton((btn) =>
    btn
      .setIcon("plus")
      .setTooltip(t("settings.createRagSetting"))
      .onClick(() => {
        new RagSettingNameModal(
          plugin.app,
          t("settings.createRagSetting"),
          "",
          async (name) => {
            try {
              await plugin.createRagSetting(name);
              await plugin.selectRagSetting(name);
              new Notice(t("settings.ragSettingCreated", { name }));
              display();
            } catch (err) {
              new Notice(err instanceof Error ? err.message : String(err));
            }
          }
        ).open();
      })
  );

  // --- Selected setting detail ---
  if (!selectedName) return;

  const ragSetting = plugin.getRagSetting(selectedName);
  if (!ragSetting) return;

  displaySelectedRagSetting(containerEl, ctx, selectedName, ragSetting);
}

function displaySelectedRagSetting(
  containerEl: HTMLElement,
  ctx: SettingsContext,
  name: string,
  ragSetting: RagSetting,
): void {
  const { plugin, display } = ctx;
  const isExternal = !!ragSetting.externalIndexPath;
  const isBundle = ragSetting.sourceRagSettings.length > 0;
  const mode: RagSettingMode = isBundle ? "combined" : isExternal ? "external" : "internal";
  const sourceReferenceSetting = ragSetting.sourceRagSettings
    .map(sourceName => plugin.getRagSetting(sourceName))
    .find((source): source is RagSetting => !!source && isStandaloneInternalRag(source));
  const sourceNames = plugin.getRagSettingNames().filter(sourceName => {
    if (sourceName === name) return false;
    const source = plugin.getRagSetting(sourceName);
    if (!source || !isStandaloneInternalRag(source)) return false;
    return !sourceReferenceSetting || hasSameEffectiveEmbeddingConfig(plugin, source, sourceReferenceSetting);
  });

  const updateSetting = async (updates: Partial<RagSetting>) => {
    await plugin.updateRagSetting(name, updates);
  };

  // Header with rename + delete
  const headerSetting = new Setting(containerEl)
    .setName(t("settings.settingsFor", { name }))
    .setHeading();

  headerSetting.addExtraButton((btn) =>
    btn
      .setIcon("pencil")
      .setTooltip(t("settings.renameSetting"))
      .onClick(() => {
        new RagSettingNameModal(
          plugin.app,
          t("settings.renameSetting"),
          name,
          async (newName) => {
            try {
              await plugin.renameRagSetting(name, newName);
              new Notice(t("settings.renamedTo", { name: newName }));
              display();
            } catch (err) {
              new Notice(err instanceof Error ? err.message : String(err));
            }
          }
        ).open();
      })
  );

  headerSetting.addExtraButton((btn) =>
    btn
      .setIcon("trash")
      .setTooltip(t("settings.deleteSetting"))
      .onClick(() => {
        const modal = new Modal(plugin.app);
        modal.titleEl.setText(t("settings.deleteSetting"));
        modal.contentEl.createEl("p", { text: t("settings.deleteSettingConfirm", { name }) });
        new Setting(modal.contentEl)
          .addButton((cancelBtn) =>
            cancelBtn.setButtonText("Cancel").onClick(() => modal.close())
          )
          .addButton((confirmBtn) =>
            confirmBtn
              .setButtonText("Delete")
              .setWarning()
              .onClick(async () => {
                modal.close();
                await deleteRagIndex(plugin.app, name);
                await plugin.deleteRagSetting(name);
                new Notice(t("settings.ragSettingDeleted", { name }));
                display();
              })
          );
        modal.open();
      })
  );

  // RAG index mode
  new Setting(containerEl)
    .setName(t("settings.ragMode"))
    .setDesc(t("settings.ragModeDesc"))
    .addDropdown((dropdown) => {
      dropdown
        .addOption("internal", t("settings.ragModeInternal"))
        .addOption("combined", t("settings.ragModeCombined"))
        .addOption("external", t("settings.ragModeExternal"))
        .setValue(mode)
        .onChange((value) => {
          const nextMode = value as RagSettingMode;
          const sourceRagSettings = nextMode === "combined"
            ? (ragSetting.sourceRagSettings.length > 0 ? ragSetting.sourceRagSettings : sourceNames.slice(0, 1))
            : [];
          const externalIndexPath = nextMode === "external" ? (ragSetting.externalIndexPath || " ") : "";
          void (async () => {
            await updateSetting({ sourceRagSettings, externalIndexPath });
            getRagStore().setExternalPath(name, externalIndexPath);
            display();
          })().catch((err) => new Notice(String(err)));
        });
    });

  if (isBundle) {
    const sourceSetting = new Setting(containerEl)
      .setName(t("settings.ragSourceSettingsSelect"))
      .setDesc(t("settings.ragSourceSettingsSelectDesc"));
    const sourceContainer = sourceSetting.controlEl.createDiv({ cls: "llm-hub-rag-source-settings" });
    if (sourceNames.length === 0) {
      sourceContainer.setText(t("settings.ragSourceSettingsEmpty"));
    } else {
      for (const sourceName of sourceNames) {
        const label = sourceContainer.createEl("label", { cls: "llm-hub-rag-source-setting-option" });
        const checkbox = label.createEl("input", {
          type: "checkbox",
          value: sourceName,
        });
        checkbox.checked = ragSetting.sourceRagSettings.includes(sourceName);
        label.createSpan({ text: sourceName });
        checkbox.addEventListener("change", () => {
          void (async () => {
            const nextSources = checkbox.checked
              ? [...ragSetting.sourceRagSettings, sourceName]
              : ragSetting.sourceRagSettings.filter(item => item !== sourceName);
            await updateSetting({ sourceRagSettings: [...new Set(nextSources)] });
            display();
          })().catch((err) => new Notice(String(err)));
        });
      }
    }
  }

  if (isExternal) {
    // External index paths
    new Setting(containerEl)
      .setName(t("settings.ragExternalIndexPath"))
      .setDesc(t("settings.ragExternalIndexPathDesc"))
      .addTextArea((text) => {
        text
          .setPlaceholder(t("settings.ragExternalIndexPathPlaceholder"))
          .setValue(ragSetting.externalIndexPath.trim())
          .onChange((value) => {
            void (async () => {
              const path = value.trim() || " "; // keep external mode selected
              await updateSetting({ externalIndexPath: path });
              getRagStore().setExternalPath(name, path);
            })().catch((err) => new Notice(String(err)));
          });
        text.inputEl.addClass("llm-hub-wide-input");
        text.inputEl.rows = 4;
      });
  }

  if (!isBundle) {
    // Embedding server URL
    new Setting(containerEl)
      .setName(t("settings.ragEmbeddingBaseUrl"))
      .setDesc(t("settings.ragEmbeddingBaseUrlDesc"))
      .addText((text) => {
        text
          .setPlaceholder(EMBEDDING_BASE_URL_PLACEHOLDER)
          .setValue(ragSetting.embeddingBaseUrl || "")
          .onChange((value) => {
            void updateSetting({ embeddingBaseUrl: value.trim() }).catch((err) => new Notice(String(err)));
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
      if (!ragSetting.embeddingModel) {
        const placeholder = select.createEl("option", { text: t("settings.ragEmbeddingModelPlaceholder"), value: "" });
        placeholder.disabled = true;
        placeholder.selected = true;
      } else {
        const opt = select.createEl("option", { text: ragSetting.embeddingModel, value: ragSetting.embeddingModel });
        opt.selected = true;
      }
      select.addEventListener("change", () => {
        void updateSetting({ embeddingModel: select.value }).catch((err) => new Notice(String(err)));
      });
    });

    embeddingModelSetting.addButton((btn) =>
      btn
        .setButtonText(t("settings.llmModal.fetchModels"))
        .onClick(async () => {
          btn.setButtonText(t("settings.llmModal.fetching"));
          btn.setDisabled(true);
          try {
            const models = await fetchEmbeddingModels(plugin.settings.llmConfig, ragSetting.embeddingBaseUrl || undefined);
            if (models.length === 0) {
              new Notice(t("settings.llmModal.noModelsFound"));
              return;
            }
            if (embeddingDropdown) {
              embeddingDropdown.empty();
              for (const model of models) {
                const opt = embeddingDropdown.createEl("option", { text: model, value: model });
                if (model === ragSetting.embeddingModel) {
                  opt.selected = true;
                }
              }
              if (!ragSetting.embeddingModel || !models.includes(ragSetting.embeddingModel)) {
                await updateSetting({ embeddingModel: models[0] });
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
  }

  if (!isExternal && !isBundle) {
    // Target folders (vault sync only)
    new Setting(containerEl)
      .setName(t("settings.ragTargetFolders"))
      .setDesc(t("settings.ragTargetFoldersDesc"))
      .addText((text) => {
        text
          .setValue(ragSetting.targetFolders.join(", "))
          .onChange((value) => {
            const folders = value.split(",").map(s => s.trim()).filter(Boolean);
            void updateSetting({ targetFolders: folders }).catch((err) => new Notice(String(err)));
          });
        text.inputEl.addClass("llm-hub-wide-input");
      });

    // Exclude patterns (vault sync only)
    new Setting(containerEl)
      .setName(t("settings.ragExcludePatterns"))
      .setDesc(t("settings.ragExcludePatternsDesc"))
      .addText((text) => {
        text
          .setValue(ragSetting.excludePatterns.join(", "))
          .onChange((value) => {
            const patterns = value.split(",").map(s => s.trim()).filter(Boolean);
            void updateSetting({ excludePatterns: patterns }).catch((err) => new Notice(String(err)));
          });
        text.inputEl.addClass("llm-hub-wide-input");
      });

    // Chunking strategy (vault sync only)
    new Setting(containerEl)
      .setName(t("settings.ragChunkStrategy"))
      .setDesc(t("settings.ragChunkStrategyDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("fixed", t("settings.ragChunkStrategyFixed"))
          .addOption("sentence", t("settings.ragChunkStrategySentence"))
          .addOption("block", t("settings.ragChunkStrategyBlock"))
          .setValue(ragSetting.chunkStrategy ?? "fixed")
          .onChange((value) => {
            void updateSetting({ chunkStrategy: value as ChunkStrategy }).catch((err) => new Notice(String(err)));
          });
      });

    // Chunk size (vault sync only)
    new Setting(containerEl)
      .setName(t("settings.ragChunkSize"))
      .setDesc(t("settings.ragChunkSizeDesc"))
      .addText((text) => {
        text
          .setValue(String(ragSetting.chunkSize))
          .onChange((value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
              void updateSetting({ chunkSize: num }).catch((err) => new Notice(String(err)));
            }
          });
        text.inputEl.type = "number";
        text.inputEl.min = "100";
        text.inputEl.step = "100";
      });

    // Chunk overlap (vault sync only)
    new Setting(containerEl)
      .setName(t("settings.ragChunkOverlap"))
      .setDesc(t("settings.ragChunkOverlapDesc"))
      .addText((text) => {
        text
          .setValue(String(ragSetting.chunkOverlap))
          .onChange((value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 0) {
              void updateSetting({ chunkOverlap: num }).catch((err) => new Notice(String(err)));
            }
          });
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.step = "50";
      });
  }

  // Top K
  new Setting(containerEl)
    .setName(t("settings.ragTopK"))
    .setDesc(t("settings.ragTopKDesc"))
    .addText((text) => {
      text
        .setValue(String(ragSetting.topK))
        .onChange((value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num > 0) {
            void updateSetting({ topK: num }).catch((err) => new Notice(String(err)));
          }
        });
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.inputEl.max = "20";
      text.inputEl.step = "1";
    });

  // Min score (slider)
  const currentMinScore = ragSetting.minScore ?? DEFAULT_RAG_SETTING.minScore;
  new Setting(containerEl)
    .setName(t("settings.ragMinScore"))
    .setDesc(t("settings.ragMinScoreDesc"))
    .addSlider((slider) => {
      slider
        .setLimits(0, 10, 1)
        .setValue(Math.round(currentMinScore * 10))
        .setDynamicTooltip()
        .onChange((value) => {
          void updateSetting({ minScore: value / 10 }).catch((err) => new Notice(String(err)));
        });
      const tooltipEl = slider.sliderEl.nextElementSibling;
      if (tooltipEl) {
        const updateTooltip = () => { tooltipEl.textContent = (slider.getValue() / 10).toFixed(1); };
        updateTooltip();
        slider.sliderEl.addEventListener("input", updateTooltip);
      }
    })
    .addExtraButton((button) =>
      button
        .setIcon("reset")
        .setTooltip("Reset to default (0.3)")
        .onClick(() => {
          void (async () => {
            await updateSetting({ minScore: DEFAULT_RAG_SETTING.minScore });
            display();
          })();
        })
    );

  // Status display
  const store = getRagStore();
  store.setExternalPath(name, ragSetting.externalIndexPath);
  const statusSetting = new Setting(containerEl);

  const updateStatusDesc = () => {
    const status = store.getStatus(name);
    if (status.totalChunks > 0) {
      const desc = isExternal
        ? `${t("settings.ragExternalActive")} — ${t("settings.ragStatus", { chunks: String(status.totalChunks), files: String(status.indexedFiles) })}`
        : t("settings.ragStatus", { chunks: String(status.totalChunks), files: String(status.indexedFiles) });
      statusSetting.setDesc(desc);
    } else {
      statusSetting.setDesc(isExternal ? t("settings.ragExternalActive") : t("settings.ragNoIndex"));
    }
  };

  updateStatusDesc();
  void store.load(plugin.app, [name], { [name]: ragSetting }).then(updateStatusDesc);

  if (!isExternal && !isBundle) {
    const progressContainer = statusSetting.settingEl.createDiv({
      cls: "llm-hub-settings-sync-progress",
    });
    progressContainer.addClass("llm-hub-hidden");
    const progressText = progressContainer.createDiv({
      cls: "llm-hub-settings-sync-progress-text",
    });
    const progressBar = progressContainer.createEl("progress", {
      cls: "llm-hub-settings-sync-progress-bar",
    });

    // Sync button (vault sync only)
    statusSetting.addButton((btn) =>
      btn
        .setButtonText(t("settings.ragSync"))
        .setCta()
        .onClick(async () => {
          btn.setButtonText(t("settings.ragSyncing"));
          btn.setDisabled(true);
          progressContainer.removeClass("llm-hub-hidden");
          progressText.removeClass("llm-hub-settings-sync-progress-error");
          progressText.setText(t("settings.syncPreparing"));
          progressBar.value = 0;
          progressBar.max = 100;
          try {
            const result = await store.sync(
              plugin.app,
              name,
              ragSetting,
              plugin.settings.llmConfig,
              undefined,
              (progress) => {
                const percent = Math.round((progress.current / Math.max(progress.total, 1)) * 100);
                progressBar.value = percent;
                progressBar.max = 100;
                if (progress.phase === "embedding") {
                  progressText.setText(`${t("settings.ragSyncingEmbeddings")}: ${progress.filePath} (${progress.current}/${progress.total})`);
                } else if (progress.phase === "saving") {
                  progressText.setText(t("settings.ragSyncSaving"));
                } else {
                  progressText.setText(`${t("settings.ragSyncingFile")}: ${progress.filePath} (${progress.current}/${progress.total})`);
                }
              },
            );
            new Notice(t("settings.ragSynced", {
              count: String(result.totalChunks),
              files: String(result.indexedFiles),
            }));
            progressContainer.addClass("llm-hub-hidden");
            display();
          } catch (err) {
            new Notice(t("settings.ragSyncFailed", {
              error: err instanceof Error ? err.message : String(err),
            }));
            progressText.setText(`${t("common.error")}: ${err instanceof Error ? err.message : String(err)}`);
            progressText.addClass("llm-hub-settings-sync-progress-error");
            window.setTimeout(() => progressContainer.addClass("llm-hub-hidden"), 2000);
          } finally {
            btn.setButtonText(t("settings.ragSync"));
            btn.setDisabled(false);
          }
        })
    );

    // Clear button (vault sync only)
    statusSetting.addButton((btn) =>
      btn
        .setButtonText(t("settings.ragClear"))
        .onClick(async () => {
          await store.clear(plugin.app, name);
          new Notice(t("settings.ragCleared"));
          display();
        })
    );
  }
}
