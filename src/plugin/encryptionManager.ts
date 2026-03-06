import { Notice, TFile, MarkdownView } from "obsidian";
import type { App } from "obsidian";
import { promptForPassword } from "src/ui/passwordPrompt";
import { isEncryptedFile, encryptFileContent, decryptFileContent } from "src/core/crypto";
import { cryptoCache } from "src/core/cryptoCache";
import { CryptView, CRYPT_VIEW_TYPE } from "src/ui/CryptView";
import { formatError } from "src/utils/error";
import { t } from "src/i18n";
import type { LocalLlmHubPlugin } from "src/plugin";

export class EncryptionManager {
  private plugin: LocalLlmHubPlugin;

  constructor(plugin: LocalLlmHubPlugin) {
    this.plugin = plugin;
  }

  private get app(): App {
    return this.plugin.app;
  }

  async encryptFile(file: TFile): Promise<void> {
    const encryption = this.plugin.settings.encryption;

    if (!encryption?.publicKey || !encryption?.encryptedPrivateKey || !encryption?.salt) {
      new Notice(t("crypt.notConfigured"));
      throw new Error(t("crypt.notConfigured"));
    }

    try {
      const content = await this.app.vault.read(file);

      if (isEncryptedFile(content)) {
        new Notice(t("crypt.alreadyEncrypted"));
        return;
      }

      const encryptedContent = await encryptFileContent(
        content,
        encryption.publicKey,
        encryption.encryptedPrivateKey,
        encryption.salt
      );

      await this.app.vault.modify(file, encryptedContent);

      const newPath = file.path + ".encrypted";
      await this.app.vault.rename(file, newPath);

      new Notice(t("crypt.encryptSuccess"));

      await this.openCryptView(file);
    } catch (error) {
      console.error("Failed to encrypt file:", formatError(error));
      new Notice(t("crypt.encryptFailed"));
    }
  }

  async checkAndOpenEncryptedFile(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.read(file);
      if (isEncryptedFile(content)) {
        setTimeout(() => {
          void this.openCryptView(file);
        }, 50);
      }
    } catch {
      // Ignore read errors
    }
  }

  async openCryptView(file: TFile): Promise<void> {
    const cryptLeaves = this.app.workspace.getLeavesOfType(CRYPT_VIEW_TYPE);
    for (const leaf of cryptLeaves) {
      const view = leaf.view as CryptView;
      if (view.file?.path === file.path) {
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
        return;
      }
    }

    const allLeaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of allLeaves) {
      const view = leaf.view as MarkdownView;
      if (view.file?.path === file.path) {
        await leaf.setViewState({
          type: CRYPT_VIEW_TYPE,
          active: true,
          state: { file: file.path },
        });
        return;
      }
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: CRYPT_VIEW_TYPE,
      active: true,
      state: { file: file.path },
    });
  }

  async decryptFile(file: TFile, decryptedContent: string): Promise<void> {
    try {
      await this.app.vault.modify(file, decryptedContent);

      if (file.path.endsWith(".encrypted")) {
        const newPath = file.path.slice(0, -".encrypted".length);
        await this.app.vault.rename(file, newPath);
      }

      new Notice(t("crypt.decryptSuccess"));
    } catch (error) {
      console.error("Failed to decrypt file:", formatError(error));
      new Notice(t("crypt.decryptFailed"));
    }
  }

  async decryptCurrentFile(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.read(file);

      if (!isEncryptedFile(content)) {
        new Notice(t("crypt.notEncrypted"));
        return;
      }

      let password = cryptoCache.getPassword();

      if (!password) {
        password = await promptForPassword(this.app);
        if (!password) {
          return;
        }
      }

      const decryptedContent = await decryptFileContent(content, password);
      cryptoCache.setPassword(password);

      await this.app.vault.modify(file, decryptedContent);

      if (file.path.endsWith(".encrypted")) {
        const newPath = file.path.slice(0, -".encrypted".length);
        await this.app.vault.rename(file, newPath);
      }

      new Notice(t("crypt.decryptSuccess"));
    } catch (error) {
      console.error("Failed to decrypt file:", formatError(error));
      new Notice(t("crypt.decryptFailed"));
    }
  }
}
