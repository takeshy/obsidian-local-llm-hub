import { Notice, Setting } from "obsidian";
import { t } from "src/i18n";
import { DEFAULT_SETTINGS, SKILLS_FOLDER, WORKSPACE_FOLDER } from "src/types";
import { isUnsafePath, normalizePathSeparators } from "src/core/pathAccess";
import type { LocalLlmHubPlugin } from "src/plugin";
import {
  addAllowedVaultFoldersSetting,
  addMaxSavedChatHistoriesSetting,
  addSystemPromptSetting,
} from "obsidian-llm-hub-common/settings";

interface SettingsContext {
  plugin: LocalLlmHubPlugin;
  display: () => void;
}

export function displayWorkspaceSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin } = ctx;

  new Setting(containerEl).setName(t("settings.workspace")).setHeading();

  const addFolderSetting = (
    name: string,
    desc: string,
    current: string,
    fallback: string,
    save: (folder: string) => Promise<void>,
  ) => {
    const setting = new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text.setPlaceholder(fallback).setValue(current || fallback);
        text.inputEl.addEventListener("blur", () => {
          void (async () => {
            const oldFolder = current || fallback;
            const raw = text.inputEl.value.trim();
            const folder = raw ? normalizePathSeparators(raw).replace(/^\/+|\/+$/g, "") : fallback;
            if (isUnsafePath(folder)) {
              new Notice(t("settings.folderPathInvalid"));
              text.setValue(oldFolder);
              return;
            }
            text.setValue(folder);
            if (folder !== oldFolder) await save(folder);
          })();
        });
      });
    setting.settingEl.addClass("llm-hub-folder-setting");
  };

  addFolderSetting(
    t("settings.workspaceFolder"),
    t("settings.workspaceFolderDesc"),
    plugin.settings.workspaceFolder,
    WORKSPACE_FOLDER,
    async (folder) => {
      const oldFolder = plugin.settings.workspaceFolder || WORKSPACE_FOLDER;
      try {
        if (await plugin.app.vault.adapter.exists(oldFolder)) {
          if (await plugin.app.vault.adapter.exists(folder)) {
            new Notice(t("settings.folderAlreadyExists"));
            ctx.display();
            return;
          }
          await plugin.app.vault.adapter.rename(oldFolder, folder);
        }
      } catch (error) {
        new Notice(t("settings.folderMoveFailed", { error: String(error) }));
        ctx.display();
        return;
      }
      plugin.settings.workspaceFolder = folder;
      await plugin.saveSettings();
      await plugin.wsManager.loadOrCreateWorkspaceState();
      ctx.display();
    },
  );

  addFolderSetting(
    t("settings.skillsFolder"),
    t("settings.skillsFolderDesc"),
    plugin.settings.skillsFolder,
    SKILLS_FOLDER,
    async (folder) => {
      const oldFolder = plugin.settings.skillsFolder || SKILLS_FOLDER;
      try {
        if (await plugin.app.vault.adapter.exists(oldFolder)) {
          if (await plugin.app.vault.adapter.exists(folder)) {
            new Notice(t("settings.folderAlreadyExists"));
            ctx.display();
            return;
          }
          await plugin.app.vault.adapter.rename(oldFolder, folder);
        }
      } catch (error) {
        new Notice(t("settings.folderMoveFailed", { error: String(error) }));
        ctx.display();
        return;
      }
      plugin.settings.skillsFolder = folder;
      await plugin.saveSettings();
      plugin.settingsEmitter.emit("skills-changed");
      ctx.display();
    },
  );

  new Setting(containerEl)
    .setName(t("settings.hideWorkspaceFolder"))
    .setDesc(t("settings.hideWorkspaceFolderDesc"))
    .addToggle((toggle) => {
      toggle
        .setValue(plugin.settings.hideWorkspaceFolder)
        .onChange(async (value) => {
          plugin.settings.hideWorkspaceFolder = value;
          await plugin.saveSettings();
        });
    });

  addAllowedVaultFoldersSetting(
    containerEl,
    ctx,
    {
      name: t("settings.vaultToolAllowedFolders"),
      desc: t("settings.vaultToolAllowedFoldersDesc"),
      placeholder: t("settings.vaultToolAllowedFoldersPlaceholder"),
    },
    {
      get: () => plugin.settings.vaultToolAllowedFolders,
      set: (folders) => { plugin.settings.vaultToolAllowedFolders = folders; },
    },
  );

  new Setting(containerEl)
    .setName(t("settings.saveChatHistory"))
    .setDesc(t("settings.saveChatHistoryDesc"))
    .addToggle((toggle) => {
      toggle
        .setValue(plugin.settings.saveChatHistory)
        .onChange(async (value) => {
          plugin.settings.saveChatHistory = value;
          await plugin.saveSettings();
        });
    });

  addMaxSavedChatHistoriesSetting(containerEl, ctx, DEFAULT_SETTINGS.maxSavedChatHistories);
  addSystemPromptSetting(containerEl, ctx, 3);
}
