import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent, forwardRef, useImperativeHandle } from "react";
import { Send, Paperclip, StopCircle, Database } from "lucide-react";
import { Notice, type App } from "obsidian";
import type { Attachment, VaultToolMode } from "src/types";
import { t } from "src/i18n";

interface SlashCommandItem {
  name: string;
  description: string;
  promptTemplate: string;
}

interface InputAreaProps {
  onSend: (content: string, attachments?: Attachment[]) => void | Promise<void>;
  onStop?: () => void;
  isLoading: boolean;
  vaultToolMode: VaultToolMode;
  ragAvailable: boolean;
  onVaultToolModeChange: (mode: VaultToolMode) => void;
  vaultFiles: string[];
  hasSelection: boolean;
  app: App;
  slashCommands?: SlashCommandItem[];
}

export interface InputAreaHandle {
  setInputValue: (value: string) => void;
  getInputValue: () => string;
  focus: () => void;
}

// Mention candidates
interface MentionItem {
  value: string;
  description: string;
  isVariable: boolean;
}

const SUPPORTED_TYPES = {
  image: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  pdf: ["application/pdf"],
  text: ["text/plain", "text/markdown", "text/csv", "application/json"],
};

const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024; // 20MB

const InputArea = forwardRef<InputAreaHandle, InputAreaProps>(function InputArea({
  onSend,
  onStop,
  isLoading,
  vaultToolMode,
  ragAvailable,
  onVaultToolModeChange,
  vaultFiles,
  hasSelection,
  app,
  slashCommands,
}, ref) {
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [showVaultToolMenu, setShowVaultToolMenu] = useState(false);
  // Mention autocomplete state
  const [showMentionAutocomplete, setShowMentionAutocomplete] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [filteredMentions, setFilteredMentions] = useState<MentionItem[]>([]);
  const [mentionStartPos, setMentionStartPos] = useState(0);
  // Slash command autocomplete state
  const [showSlashAutocomplete, setShowSlashAutocomplete] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [filteredSlashCommands, setFilteredSlashCommands] = useState<SlashCommandItem[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionAutocompleteRef = useRef<HTMLDivElement>(null);
  const vaultToolMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showMentionAutocomplete && mentionAutocompleteRef.current) {
      const container = mentionAutocompleteRef.current;
      const activeItem = container.children[mentionIndex] as HTMLElement;
      if (activeItem) {
        activeItem.scrollIntoView({ block: "nearest" });
      }
    }
  }, [mentionIndex, showMentionAutocomplete]);

  // Close vault tool menu on click outside
  useEffect(() => {
    if (!showVaultToolMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (vaultToolMenuRef.current && !vaultToolMenuRef.current.contains(e.target as Node)) {
        setShowVaultToolMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showVaultToolMenu]);

  useImperativeHandle(ref, () => ({
    setInputValue: (value: string) => setInput(value),
    getInputValue: () => input,
    focus: () => textareaRef.current?.focus(),
  }));

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.setCssProps({ height: "auto" });
      const height = `${Math.min(textarea.scrollHeight, 200)}px`;
      textarea.setCssProps({ height });
    }
  }, [input]);

  const buildMentionCandidates = (query: string): MentionItem[] => {
    const hasActiveNote = !!app.workspace.getActiveFile();
    const variables: MentionItem[] = [
      ...(hasSelection ? [{ value: "{selection}", description: t("input.selectionVariable"), isVariable: true }] : []),
      ...(hasActiveNote ? [{ value: "{content}", description: t("input.contentVariable"), isVariable: true }] : []),
    ];
    const files: MentionItem[] = vaultFiles.map((f) => ({
      value: f,
      description: "Vault file",
      isVariable: false,
    }));
    const all = [...variables, ...files];
    if (!query) return all.slice(0, 10);
    const lowerQuery = query.toLowerCase();
    return all.filter((item) => item.value.toLowerCase().includes(lowerQuery)).slice(0, 10);
  };

  const handleSubmit = () => {
    if ((input.trim() || pendingAttachments.length > 0) && !isLoading) {
      void onSend(input, pendingAttachments.length > 0 ? pendingAttachments : undefined);
      setInput("");
      setPendingAttachments([]);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setInput(value);

    // Check for / slash command trigger (only at start of input)
    if (slashCommands && slashCommands.length > 0) {
      const slashMatch = value.match(/^\/([^\s]*)$/);
      if (slashMatch) {
        const query = slashMatch[1].toLowerCase();
        const filtered = slashCommands.filter(
          (cmd) => cmd.name.toLowerCase().includes(query)
        );
        setFilteredSlashCommands(filtered);
        setShowSlashAutocomplete(filtered.length > 0);
        setSlashIndex(0);
        setShowMentionAutocomplete(false);
        return;
      }
    }
    setShowSlashAutocomplete(false);

    // Check for @ mention trigger
    const textBeforeCursor = value.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);
    if (atMatch) {
      const query = atMatch[1];
      const startPos = cursorPos - atMatch[0].length;
      const mentions = buildMentionCandidates(query);
      setFilteredMentions(mentions);
      setMentionStartPos(startPos);
      setShowMentionAutocomplete(mentions.length > 0);
      setMentionIndex(0);
    } else {
      setShowMentionAutocomplete(false);
    }
  };

  const selectMention = (mention: MentionItem) => {
    const cursorPos = textareaRef.current?.selectionStart || input.length;
    const before = input.substring(0, mentionStartPos);
    const after = input.substring(cursorPos);
    const newInput = before + mention.value + " " + after;
    setInput(newInput);
    setShowMentionAutocomplete(false);
    setTimeout(() => {
      const newPos = mentionStartPos + mention.value.length + 1;
      textareaRef.current?.setSelectionRange(newPos, newPos);
      textareaRef.current?.focus();
    }, 0);
  };

  const selectSlashCommand = (cmd: SlashCommandItem) => {
    setInput(cmd.promptTemplate);
    setShowSlashAutocomplete(false);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash command autocomplete
    if (showSlashAutocomplete) {
      if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        setSlashIndex((prev) => Math.min(prev + 1, filteredSlashCommands.length - 1));
        return;
      }
      if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        setSlashIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" && !e.nativeEvent.isComposing && filteredSlashCommands.length > 0) {
        e.preventDefault();
        selectSlashCommand(filteredSlashCommands[slashIndex]);
        return;
      }
      if (e.key === "Escape") {
        setShowSlashAutocomplete(false);
        return;
      }
    }

    // Mention autocomplete
    if (showMentionAutocomplete) {
      if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        setMentionIndex((prev) =>
          Math.min(prev + 1, filteredMentions.length - 1)
        );
        return;
      }
      if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        setMentionIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" && !e.nativeEvent.isComposing && filteredMentions.length > 0) {
        e.preventDefault();
        selectMention(filteredMentions[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        setShowMentionAutocomplete(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      const attachment = await processFile(file);
      if (attachment) {
        setPendingAttachments(prev => [...prev, attachment]);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const processFile = async (file: File): Promise<Attachment | null> => {
    const mimeType = file.type;

    if (file.size > MAX_ATTACHMENT_SIZE) {
      new Notice(t("input.fileTooLarge", { name: file.name }));
      return null;
    }

    if (SUPPORTED_TYPES.image.includes(mimeType)) {
      const data = await fileToBase64(file);
      return { name: file.name, type: "image", mimeType, data };
    }

    if (SUPPORTED_TYPES.pdf.includes(mimeType)) {
      const data = await fileToBase64(file);
      return { name: file.name, type: "pdf", mimeType, data };
    }

    if (SUPPORTED_TYPES.text.includes(mimeType) || file.name.endsWith(".md") || file.name.endsWith(".txt")) {
      const data = await fileToBase64(file);
      return { name: file.name, type: "text", mimeType: mimeType || "text/plain", data };
    }

    return null;
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (index: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const getAllAcceptedTypes = () => {
    return [...SUPPORTED_TYPES.image, ...SUPPORTED_TYPES.pdf, ...SUPPORTED_TYPES.text, ".md", ".txt"].join(",");
  };

  return (
    <div className="llm-hub-input-container">
      {/* Pending attachments display */}
      {pendingAttachments.length > 0 && (
        <div className="llm-hub-pending-attachments">
          {pendingAttachments.map((attachment, index) => (
            <span key={index} className="llm-hub-pending-attachment">
              {attachment.type === "image" && "🖼️"}
              {attachment.type === "pdf" && "📄"}
              {attachment.type === "text" && "📃"}
              {" "}{attachment.name}
              <button
                className="llm-hub-pending-attachment-remove"
                onClick={() => removeAttachment(index)}
                title={t("input.removeAttachment")}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="llm-hub-input-area">
        {/* Slash command autocomplete */}
        {showSlashAutocomplete && (
          <div className="llm-hub-autocomplete">
            {filteredSlashCommands.map((cmd, index) => (
              <div
                key={cmd.name}
                className={`llm-hub-autocomplete-item ${
                  index === slashIndex ? "active" : ""
                }`}
                onClick={() => selectSlashCommand(cmd)}
                onMouseEnter={() => setSlashIndex(index)}
              >
                <span className="llm-hub-autocomplete-name">
                  /{cmd.name}
                </span>
                <span className="llm-hub-autocomplete-desc">
                  {cmd.description || cmd.promptTemplate.slice(0, 40)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Mention autocomplete */}
        {showMentionAutocomplete && (
          <div className="llm-hub-autocomplete" ref={mentionAutocompleteRef}>
            {filteredMentions.map((mention, index) => (
              <div
                key={mention.value}
                className={`llm-hub-autocomplete-item ${
                  index === mentionIndex ? "active" : ""
                }`}
                onClick={() => selectMention(mention)}
                onMouseEnter={() => setMentionIndex(index)}
              >
                <span className="llm-hub-autocomplete-name">
                  {mention.value}
                </span>
                <span className="llm-hub-autocomplete-desc">
                  {mention.description}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={getAllAcceptedTypes()}
          onChange={(event) => {
            void handleFileSelect(event);
          }}
          className="llm-hub-hidden-input"
        />

        {/* Left button column */}
        <div className="llm-hub-input-buttons">
          <button
            className="llm-hub-attachment-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            title={t("input.attach")}
          >
            <Paperclip size={18} />
          </button>
          {ragAvailable && (
            <div className="llm-hub-vault-tool-container" ref={vaultToolMenuRef}>
              <button
                className={`llm-hub-vault-tool-btn ${vaultToolMode !== "all" ? "active" : ""}`}
                onClick={() => setShowVaultToolMenu(!showVaultToolMenu)}
                disabled={isLoading}
                title={t("input.vaultToolTitle")}
              >
                <Database size={18} />
              </button>
              {showVaultToolMenu && (
                <div className="llm-hub-vault-tool-menu">
                  {(["all", "noSearch", "none"] as const).map((mode) => (
                    <div
                      key={mode}
                      className={`llm-hub-vault-tool-item ${vaultToolMode === mode ? "selected" : ""}`}
                      onClick={() => {
                        onVaultToolModeChange(mode);
                        setShowVaultToolMenu(false);
                      }}
                    >
                      {t(`input.vaultTool_${mode}` as Parameters<typeof t>[0])}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <textarea
          ref={textareaRef}
          className="llm-hub-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={t("input.placeholder")}
          rows={3}
        />
        <div className="llm-hub-send-buttons">
          {isLoading ? (
            <button
              className="llm-hub-stop-btn"
              onClick={onStop}
              title={t("input.stop")}
            >
              <StopCircle size={18} />
            </button>
          ) : (
            <button
              className="llm-hub-send-btn"
              onClick={handleSubmit}
              disabled={!input.trim() && pendingAttachments.length === 0}
              title={t("input.send")}
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </div>

    </div>
  );
});

export default InputArea;
