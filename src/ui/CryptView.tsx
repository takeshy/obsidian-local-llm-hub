import { createRoot, Root } from "react-dom/client";
import { TextFileView, WorkspaceLeaf, IconName, Notice } from "obsidian";
import type { LocalLlmHubPlugin } from "src/plugin";
import CryptEditor from "./components/CryptEditor";
import {
  isEncryptedFile,
  encryptFileContent,
} from "src/core/crypto";
import { formatError } from "src/utils/error";

export const CRYPT_VIEW_TYPE = "llm-hub-crypt-view";

export class CryptView extends TextFileView {
  plugin: LocalLlmHubPlugin;
  reactRoot: Root | null = null;
  private currentData: string = "";

  constructor(leaf: WorkspaceLeaf, plugin: LocalLlmHubPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CRYPT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.name || "Encrypted";
  }

  getIcon(): IconName {
    return "lock";
  }

  getViewData(): string {
    return this.currentData;
  }

  setViewData(data: string, clear: boolean): void {
    this.currentData = data;
    if (clear) {
      this.reactRoot?.unmount();
      this.reactRoot = null;
    }
    this.renderContent();
  }

  clear(): void {
    this.currentData = "";
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.contentEl.empty();
  }

  private renderContent(): void {
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }

    const container = this.contentEl;
    container.empty();
    container.addClass("llm-hub-crypt-container");

    if (!this.currentData) {
      container.createEl("div", {
        text: "No content",
        cls: "llm-hub-crypt-error",
      });
      return;
    }

    if (!isEncryptedFile(this.currentData)) {
      container.createEl("div", {
        text: "File is not encrypted",
        cls: "llm-hub-crypt-error",
      });
      return;
    }

    const filePath = this.file?.path || "";

    const root = createRoot(container);
    root.render(
      <CryptEditor
        plugin={this.plugin}
        filePath={filePath}
        encryptedContent={this.currentData}
        onSave={async (newContent: string) => {
          await this.saveEncrypted(newContent);
        }}
        onDecrypt={async (decryptedContent: string) => {
          await this.saveDecrypted(decryptedContent);
        }}
      />
    );
    this.reactRoot = root;
  }

  async onClose(): Promise<void> {
    this.reactRoot?.unmount();
    await Promise.resolve();
  }

  private async saveEncrypted(content: string): Promise<void> {
    if (!this.file) return;

    const encryption = this.plugin.settings.encryption;
    if (!encryption?.publicKey || !encryption?.encryptedPrivateKey || !encryption?.salt) {
      new Notice("Encryption not configured");
      return;
    }

    try {
      const encryptedContent = await encryptFileContent(
        content,
        encryption.publicKey,
        encryption.encryptedPrivateKey,
        encryption.salt
      );
      this.currentData = encryptedContent;
      this.requestSave();
      new Notice("File saved (encrypted)");
    } catch (error) {
      console.error("Failed to save encrypted file:", formatError(error));
      new Notice("Failed to save file");
    }
  }

  private async saveDecrypted(content: string): Promise<void> {
    if (!this.file) return;

    try {
      this.currentData = content;
      this.requestSave();

      let openPath = this.file.path;
      if (this.file.path.endsWith(".encrypted")) {
        const newPath = this.file.path.slice(0, -".encrypted".length);
        await this.plugin.app.vault.rename(this.file, newPath);
        openPath = newPath;
      }

      new Notice("File decrypted and saved");

      this.leaf.detach();
      await this.plugin.app.workspace.openLinkText(openPath, "", false);
    } catch (error) {
      console.error("Failed to save decrypted file:", formatError(error));
      new Notice("Failed to decrypt file");
    }
  }
}
