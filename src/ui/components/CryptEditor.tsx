import { useState, useEffect, useRef, useCallback } from "react";
import { Notice, MarkdownRenderer, Component, Modal, App } from "obsidian";
import { Save, Unlock, Eye, Edit2, Lock } from "lucide-react";
import type { LocalLlmHubPlugin } from "src/plugin";
import {
  decryptFileContent,
  unwrapEncryptedFile,
  decryptPrivateKey,
} from "src/core/crypto";
import { cryptoCache } from "src/core/cryptoCache";
import { formatError } from "src/utils/error";
import { t } from "src/i18n";

interface CryptEditorProps {
  plugin: LocalLlmHubPlugin;
  filePath: string;
  encryptedContent: string;
  onSave: (content: string) => Promise<void>;
  onDecrypt: (content: string) => Promise<void>;
}

export default function CryptEditor({
  plugin,
  filePath,
  encryptedContent,
  onSave,
  onDecrypt,
}: CryptEditorProps) {
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string>("");
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [previewNode, setPreviewNode] = useState<HTMLDivElement | null>(null);
  const previewRef = useCallback((node: HTMLDivElement | null) => {
    setPreviewNode(node);
  }, []);
  const previewComponent = useRef<Component | null>(null);

  useEffect(() => {
    const tryDecrypt = async () => {
      const cachedPassword = cryptoCache.getPassword();
      if (cachedPassword) {
        setIsDecrypting(true);
        try {
          const content = await decryptFileContent(encryptedContent, cachedPassword);
          setDecryptedContent(content);
          setEditedContent(content);
        } catch (error) {
          console.error("Failed to decrypt with cached password:", formatError(error));
          setNeedsPassword(true);
        } finally {
          setIsDecrypting(false);
        }
      } else {
        setNeedsPassword(true);
      }
    };

    void tryDecrypt();
  }, [encryptedContent]);

  const handlePasswordSubmit = async () => {
    if (!password) return;

    setIsDecrypting(true);
    try {
      const content = await decryptFileContent(encryptedContent, password);
      setDecryptedContent(content);
      setEditedContent(content);
      setNeedsPassword(false);

      cryptoCache.setPassword(password);

      const encrypted = unwrapEncryptedFile(encryptedContent);
      if (encrypted) {
        const privateKey = await decryptPrivateKey(encrypted.key, encrypted.salt, password);
        cryptoCache.setPrivateKey(privateKey);
      }
    } catch (error) {
      console.error("Failed to decrypt:", formatError(error));
      new Notice(t("crypt.wrongPassword"));
    } finally {
      setIsDecrypting(false);
    }
  };

  useEffect(() => {
    if (showPreview && previewNode && editedContent) {
      previewNode.empty();

      if (previewComponent.current) {
        previewComponent.current.unload();
      }
      previewComponent.current = new Component();
      previewComponent.current.load();

      void MarkdownRenderer.render(
        plugin.app,
        editedContent,
        previewNode,
        filePath,
        previewComponent.current
      );
    }

    return () => {
      if (previewComponent.current) {
        previewComponent.current.unload();
        previewComponent.current = null;
      }
    };
  }, [showPreview, editedContent, previewNode, plugin.app, filePath]);

  useEffect(() => {
    setHasChanges(editedContent !== decryptedContent);
  }, [editedContent, decryptedContent]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(editedContent);
      setDecryptedContent(editedContent);
      setHasChanges(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDecrypt = async () => {
    const confirmed = await new Promise<boolean>((resolve) => {
      class ConfirmDecryptModal extends Modal {
        constructor(app: App) {
          super(app);
        }
        onOpen() {
          this.contentEl.createEl("h3", { text: t("crypt.confirmDecrypt") });
          this.contentEl.createEl("p", { text: t("crypt.confirmDecryptDesc") });

          const buttonContainer = this.contentEl.createDiv({ cls: "modal-button-container" });

          buttonContainer.createEl("button", {
            text: t("common.cancel"),
            cls: "mod-cta",
          }).onclick = () => {
            this.close();
            resolve(false);
          };

          buttonContainer.createEl("button", {
            text: t("crypt.removeEncryption"),
          }).onclick = () => {
            this.close();
            resolve(true);
          };
        }
      }
      const modal = new ConfirmDecryptModal(plugin.app);
      modal.open();
    });

    if (confirmed) {
      await onDecrypt(editedContent);
    }
  };

  if (needsPassword) {
    return (
      <div className="llm-hub-crypt-password">
        <div className="llm-hub-crypt-password-icon">
          <Lock size={48} />
        </div>
        <h3>{t("crypt.enterPassword")}</h3>
        <p>{t("crypt.enterPasswordDesc")}</p>
        <div className="llm-hub-crypt-password-form">
          <input
            type="password"
            placeholder={t("crypt.passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handlePasswordSubmit();
              }
            }}
            disabled={isDecrypting}
            autoFocus
          />
          <button
            onClick={() => void handlePasswordSubmit()}
            disabled={isDecrypting || !password}
            className="mod-cta"
          >
            {isDecrypting ? t("crypt.decrypting") : t("crypt.unlock")}
          </button>
        </div>
      </div>
    );
  }

  if (isDecrypting || decryptedContent === null) {
    return (
      <div className="llm-hub-crypt-loading">
        <p>{t("crypt.decrypting")}</p>
      </div>
    );
  }

  return (
    <div className="llm-hub-crypt-editor">
      <div className="llm-hub-crypt-toolbar">
        <div className="llm-hub-crypt-toolbar-left">
          <span className="llm-hub-crypt-filename">
            <Lock size={14} />
            {filePath.split("/").pop()}
          </span>
          {hasChanges && (
            <span className="llm-hub-crypt-unsaved">
              {t("crypt.unsavedChanges")}
            </span>
          )}
        </div>
        <div className="llm-hub-crypt-toolbar-right">
          <button
            className={`llm-hub-crypt-btn ${showPreview ? "active" : ""}`}
            onClick={() => setShowPreview(!showPreview)}
            title={showPreview ? t("crypt.edit") : t("crypt.preview")}
          >
            {showPreview ? <Edit2 size={16} /> : <Eye size={16} />}
          </button>
          <button
            className="llm-hub-crypt-btn"
            onClick={() => void handleSave()}
            disabled={isSaving || !hasChanges}
            title={t("crypt.save")}
          >
            <Save size={16} />
            {t("crypt.save")}
          </button>
          <button
            className="llm-hub-crypt-btn llm-hub-crypt-btn-decrypt"
            onClick={() => void handleDecrypt()}
            title={t("crypt.removeEncryption")}
          >
            <Unlock size={16} />
            {t("crypt.removeEncryption")}
          </button>
        </div>
      </div>

      <div className="llm-hub-crypt-content">
        {showPreview ? (
          <div
            ref={previewRef}
            className="llm-hub-crypt-preview markdown-preview-view"
          />
        ) : (
          <textarea
            className="llm-hub-crypt-textarea"
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            placeholder={t("crypt.editorPlaceholder")}
          />
        )}
      </div>
    </div>
  );
}
