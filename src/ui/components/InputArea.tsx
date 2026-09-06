import { InputArea as SharedInputArea } from "obsidian-llm-hub-chat-ui";
import { Composer, Autocomplete, Attachments, VaultToolMenu, VaultToolButton, EnabledMcpServers, McpServerToggles, InputButtons, SearchSelector, ModelRow, HistoryLimit } from "obsidian-llm-hub-chat-ui";
import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent, forwardRef, useImperativeHandle } from "react";
import { Notice, type App } from "obsidian";
import type { Attachment, VaultToolMode } from "src/types";
import type { McpServerInfo } from "src/core/mcpManager";
import type { SkillMetadata } from "src/core/skillsLoader";
import type { OkfBundle } from "src/core/okfLoader";
import { RagSourceModal } from "./RagSourceModal";
import SkillSelector from "./SkillSelector";
import OkfSelector from "./OkfSelector";
import ModelSelector from "./ModelSelector";
import { t } from "src/i18n";
import { isCaretOnFirstLine, isCaretOnLastLine } from "./chat/chatUtils";

interface SlashCommandItem {
  name: string;
  description: string;
  promptTemplate: string;
  vaultToolMode?: VaultToolMode | null;
  skillPath?: string;
}

interface InputAreaProps {
  onSend: (content: string, attachments?: Attachment[], skillPath?: string) => void | Promise<void>;
  onStop?: () => void;
  onCompact?: () => void;
  isLoading: boolean;
  isCompacting?: boolean;
  messageCount?: number;
  currentModel: string;
  availableModels: string[];
  onModelChange: (model: string) => void;
  ragSettingNames: string[];
  selectedRagSetting: string | null;
  onRagSettingChange: (setting: string | null) => void;
  ragSearchAvailable: boolean;
  vaultToolMode: VaultToolMode;
  onVaultToolModeChange: (mode: VaultToolMode) => void;
  mcpServerInfos: McpServerInfo[];
  enabledMcpServerIds: Set<string>;
  onMcpServerToggle: (serverId: string, enabled: boolean) => void;
  vaultFiles: string[];
  hasSelection: boolean;
  app: App;
  slashCommands?: SlashCommandItem[];
  availableSkills?: SkillMetadata[];
  activeSkillPaths?: string[];
  onToggleSkill?: (folderPath: string) => void;
  okfBundles?: OkfBundle[];
  activeOkfBundleIds?: string[];
  onToggleOkfBundle?: (bundleId: string) => void;
  maxPreviousMessages: number;
  onMaxPreviousMessagesChange: (count: number) => void;
  inputHistory: string[];
  onInputHistoryAdd: (prompt: string) => void;
}

export interface InputAreaHandle {
  setInputValue: (value: string) => void;
  getInputValue: () => string;
  focus: () => void;
  addAttachments: (attachments: Attachment[]) => void;
}

// Mention candidates
interface MentionItem {
  value: string;
  description: string;
  kind: "variable" | "mention" | "wikilink";
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
  onCompact,
  isLoading,
  messageCount,
  currentModel,
  availableModels,
  onModelChange,
  ragSettingNames,
  selectedRagSetting,
  ragSearchAvailable,
  onRagSettingChange,
  vaultToolMode,
  onVaultToolModeChange,
  mcpServerInfos,
  enabledMcpServerIds,
  onMcpServerToggle,
  vaultFiles,
  hasSelection,
  app,
  slashCommands,
  availableSkills,
  activeSkillPaths,
  onToggleSkill,
  okfBundles = [],
  activeOkfBundleIds = [],
  onToggleOkfBundle,
  maxPreviousMessages,
  onMaxPreviousMessagesChange,
  inputHistory,
  onInputHistoryAdd,
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
  const historyIndexRef = useRef<number | null>(null);
  const historyDraftRef = useRef("");

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
    activeDocument.addEventListener("mousedown", handleClick);
    return () => activeDocument.removeEventListener("mousedown", handleClick);
  }, [showVaultToolMenu]);

  useImperativeHandle(ref, () => ({
    setInputValue: (value: string) => setInput(value),
    getInputValue: () => input,
    focus: () => textareaRef.current?.focus(),
    addAttachments: (attachments: Attachment[]) => setPendingAttachments(prev => [...prev, ...attachments]),
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
      ...(hasSelection ? [{ value: "{selection}", description: t("input.selectionVariable"), kind: "variable" as const }] : []),
      ...(hasActiveNote ? [{ value: "{content}", description: t("input.contentVariable"), kind: "variable" as const }] : []),
    ];
    const files: MentionItem[] = vaultFiles.map((f) => ({
      value: f,
      description: "Vault file",
      kind: "mention",
    }));
    const all = [...variables, ...files];
    if (!query) return all.slice(0, 10);
    const lowerQuery = query.toLowerCase();
    return all.filter((item) => item.value.toLowerCase().includes(lowerQuery)).slice(0, 10);
  };

  const buildWikilinkCandidates = (query: string): MentionItem[] => {
    const lowerQuery = query.toLowerCase();
    return vaultFiles
      .filter((file) => !lowerQuery || file.toLowerCase().includes(lowerQuery))
      .slice(0, 10)
      .map((file) => ({
        value: file,
        description: "Vault file",
        kind: "wikilink" as const,
      }));
  };

  const handleSubmit = () => {
    if (isLoading) return;

    // Check for /skillName [message] pattern on submit
    const skillSlashMatch = input.match(/^\/(\S+)(\s+.*)?$/);
    if (skillSlashMatch) {
      const cmdName = skillSlashMatch[1].toLowerCase();
      const allCommands = slashCommands || [];
      const skillCmd = allCommands.find(
        (cmd) => cmd.skillPath && cmd.name.toLowerCase() === cmdName
      );
      if (skillCmd?.skillPath) {
        const message = skillSlashMatch[2]?.trim() || "";
        if (input.trim()) onInputHistoryAdd(input);
        setInput("");
        setPendingAttachments([]);
        historyIndexRef.current = null;
        historyDraftRef.current = "";
        void onSend(message, undefined, skillCmd.skillPath);
        return;
      }
    }

    if (input.trim() || pendingAttachments.length > 0) {
      if (input.trim()) onInputHistoryAdd(input);
      void onSend(input, pendingAttachments.length > 0 ? pendingAttachments : undefined);
      setInput("");
      setPendingAttachments([]);
      historyIndexRef.current = null;
      historyDraftRef.current = "";
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setInput(value);
    historyIndexRef.current = null;

    // Check for / slash command trigger (only at start of input)
    const slashMatch = value.match(/^\/(\S*)(\s.*)?$/);
    if (slashMatch) {
      const query = slashMatch[1].toLowerCase();
      const hasTrailingContent = !!slashMatch[2];
      // Built-in commands
      const builtIn: SlashCommandItem[] = [];
      if (onCompact && (messageCount ?? 0) >= 2) {
        builtIn.push({ name: "compact", description: t("command.compact"), promptTemplate: "" });
      }
      const allCommands = [...builtIn, ...(slashCommands || [])];

      const filtered = allCommands.filter(
        (cmd) => cmd.name.toLowerCase().includes(query)
      );
      setFilteredSlashCommands(filtered);
      setShowSlashAutocomplete(filtered.length > 0 && !hasTrailingContent);
      setSlashIndex(0);
      setShowMentionAutocomplete(false);
      return;
    }
    setShowSlashAutocomplete(false);

    // Check for [[ wikilink trigger
    const textBeforeCursor = value.substring(0, cursorPos);
    const wikiMatch = textBeforeCursor.match(/\[\[([^\]\n]*)$/);
    if (wikiMatch) {
      const query = wikiMatch[1];
      const startPos = cursorPos - wikiMatch[0].length;
      const mentions = buildWikilinkCandidates(query);
      setFilteredMentions(mentions);
      setMentionStartPos(startPos);
      setShowMentionAutocomplete(mentions.length > 0);
      setMentionIndex(0);
      return;
    }

    // Check for @ mention trigger
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
    const inserted = mention.kind === "wikilink" ? `[[${mention.value}]]` : `${mention.value} `;
    const newInput = before + inserted + after;
    setInput(newInput);
    setShowMentionAutocomplete(false);
    window.setTimeout(() => {
      const newPos = mentionStartPos + inserted.length;
      textareaRef.current?.setSelectionRange(newPos, newPos);
      textareaRef.current?.focus();
    }, 0);
  };

  const selectSlashCommand = (cmd: SlashCommandItem) => {
    if (cmd.name === "compact") {
      setInput("");
      setShowSlashAutocomplete(false);
      onCompact?.();
      return;
    }
    // Skill slash commands: send immediately with skill path
    if (cmd.skillPath) {
      setInput("");
      setShowSlashAutocomplete(false);
      void onSend("", undefined, cmd.skillPath);
      return;
    }
    setInput(cmd.promptTemplate);
    setShowSlashAutocomplete(false);
    // Apply vault tool mode override if set
    if (cmd.vaultToolMode !== null && cmd.vaultToolMode !== undefined) {
      onVaultToolModeChange(cmd.vaultToolMode);
    }
    window.setTimeout(() => {
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
      if (e.key === "O" && e.ctrlKey && e.shiftKey && filteredMentions.length > 0) {
        e.preventDefault();
        const mention = filteredMentions[mentionIndex];
        if (mention && mention.kind !== "variable") {
          void app.workspace.openLinkText(mention.value, "", true);
          window.setTimeout(() => textareaRef.current?.focus(), 100);
        }
        return;
      }
      if (e.key === "Escape") {
        setShowMentionAutocomplete(false);
        return;
      }
    }

    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && inputHistory.length > 0
      && e.currentTarget.selectionStart === e.currentTarget.selectionEnd) {
      const caret = e.currentTarget.selectionStart;
      if (e.key === "ArrowUp" && isCaretOnFirstLine(input, caret)) {
        e.preventDefault();
        const nextIndex = historyIndexRef.current === null
          ? inputHistory.length - 1
          : Math.max(0, historyIndexRef.current - 1);
        if (historyIndexRef.current === null) historyDraftRef.current = input;
        historyIndexRef.current = nextIndex;
        setInput(inputHistory[nextIndex]);
        return;
      }
      if (e.key === "ArrowDown" && historyIndexRef.current !== null && isCaretOnLastLine(input, caret)) {
        e.preventDefault();
        const nextIndex = historyIndexRef.current + 1;
        if (nextIndex >= inputHistory.length) {
          historyIndexRef.current = null;
          setInput(historyDraftRef.current);
        } else {
          historyIndexRef.current = nextIndex;
          setInput(inputHistory[nextIndex]);
        }
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

  const enabledMcpServers = mcpServerInfos.filter((server) => enabledMcpServerIds.has(server.id));

  return (
    <SharedInputArea classPrefix="llm-hub" className="llm-hub-input-container"
      beforeInput={<>
      {/* MCP servers enabled for this chat */}
      <EnabledMcpServers
        classPrefix="llm-hub"
        disabled={isLoading}
        onDisable={(id) => onMcpServerToggle(id, false)}
        servers={enabledMcpServers.map((server) => ({
          id: server.id,
          name: server.name,
          title: t("input.mcpServerEnabled", { name: server.name }),
          removeTitle: t("input.mcpServerDisable", { name: server.name }),
        }))}
      />

      {/* Pending attachments display */}
      <Attachments
        classPrefix="llm-hub"
        pending
        attachments={pendingAttachments.map((attachment, index) => ({
          type: attachment.type,
          name: attachment.name,
          // RAG sources keep their origin note, so the chip opens it for review.
          open: attachment.sourcePath ? {
            title: t("ragSource.clickToView"),
            onOpen: () => {
              new RagSourceModal(app, attachment, (result) => {
                setPendingAttachments(prev => {
                  const next = [...prev];
                  next[index] = result.attachment;
                  return next;
                });
              }).open();
            },
          } : undefined,
        }))}
        onRemove={removeAttachment}
        removeLabel={t("input.removeAttachment")}
      />

      </>}
      accessories={<>
        {/* Slash command autocomplete */}
        {showSlashAutocomplete && (
          <Autocomplete classPrefix="llm-hub"
            items={filteredSlashCommands.map(cmd => ({ id: cmd.name, label: `/${cmd.name}`, description: cmd.description || cmd.promptTemplate.slice(0, 40) }))}
            activeIndex={slashIndex} onSelect={index => selectSlashCommand(filteredSlashCommands[index])} onHover={setSlashIndex} />
        )}

        {/* Mention autocomplete */}
        {showMentionAutocomplete && (
          <Autocomplete classPrefix="llm-hub" containerRef={mentionAutocompleteRef}
            items={filteredMentions.map(mention => ({ id: mention.value, label: mention.kind === "wikilink" ? `[[${mention.value}]]` : mention.value, description: mention.description }))}
            activeIndex={mentionIndex} onSelect={index => selectMention(filteredMentions[index])} onHover={setMentionIndex} />
        )}

        <InputButtons
          classPrefix="llm-hub"
          attach={{
            title: t("input.attach"),
            accept: getAllAcceptedTypes(),
            inputRef: fileInputRef,
            disabled: isLoading,
            onOpenPicker: () => fileInputRef.current?.click(),
            onSelect: (event) => {
              void handleFileSelect(event);
            },
          }}
        >
          <VaultToolButton
            classPrefix="llm-hub"
            containerRef={vaultToolMenuRef}
            title={t("input.vaultToolTitle")}
            active={vaultToolMode !== "all"}
            disabled={isLoading}
            onClick={() => setShowVaultToolMenu(!showVaultToolMenu)}
          >
            {showVaultToolMenu && (
              <VaultToolMenu<VaultToolMode>
                classPrefix="llm-hub"
                options={(["all", "noSearch", "readOnly", "none"] as const).map((mode) => ({
                  id: mode,
                  label: t(`input.vaultTool_${mode}` as Parameters<typeof t>[0]),
                  description: t(`input.vaultTool_${mode}Desc` as Parameters<typeof t>[0]),
                  selected: vaultToolMode === mode,
                }))}
                onSelect={(mode) => {
                  onVaultToolModeChange(mode);
                  setShowVaultToolMenu(false);
                }}
              >
                {mcpServerInfos.length > 0 && (
                  <>
                    <div className="llm-hub-vault-tool-divider" />
                    <div className="llm-hub-vault-tool-section-label">
                      {t("input.mcpServersLabel")}
                    </div>
                    <McpServerToggles
                      classPrefix="llm-hub"
                      onToggle={onMcpServerToggle}
                      servers={mcpServerInfos.map((server) => ({
                        id: server.id,
                        name: server.name,
                        enabled: enabledMcpServerIds.has(server.id),
                        hint: server.toolCount > 0
                          ? t("input.mcpToolHint", { count: String(server.toolCount), tools: server.toolNames.slice(0, 3).join(", ") + (server.toolCount > 3 ? ", ..." : "") })
                          : "",
                        toolsTitle: server.toolNames.join(", "),
                      }))}
                    />
                  </>
                )}
                <HistoryLimit classPrefix="llm-hub" label={t("input.historyLimit")}
                  value={maxPreviousMessages} onChange={onMaxPreviousMessagesChange} />
              </VaultToolMenu>
            )}
          </VaultToolButton>
        </InputButtons>

        </>}
      composer={<Composer classPrefix="llm-hub" textareaRef={textareaRef}
          textarea={{ value: input,
          onChange: handleInputChange,
          onKeyDown: handleKeyDown,
          placeholder: t("input.placeholder") }}
          isLoading={isLoading}
          canSend={!!input.trim() || pendingAttachments.length > 0}
          onSend={handleSubmit} onStop={onStop}
          sendLabel={t("input.send")} stopLabel={t("input.stop")}

        />}
      footer={<>

      {/* Model & RAG selector */}
      {(availableModels.length > 1 || ragSettingNames.length > 0) && (
        <ModelRow classPrefix="llm-hub" label={availableModels.length > 1 ? t("input.model") : undefined}>
          {availableModels.length > 1 && (
            <ModelSelector
              models={availableModels}
              value={currentModel}
              onChange={onModelChange}
              disabled={isLoading || !ragSearchAvailable}
            />
          )}
          {ragSettingNames.length > 0 && (
            <SearchSelector
              classPrefix="llm-hub"
              ownerDocument={activeDocument}
              disabled={isLoading}
              labels={{
                rag: (name) => t("input.rag", { name }),
                ragNone: t("input.rag", { name: t("common.none") }),
                none: t("input.searchNone"),
                webSearch: "",
              }}
              rag={{
                settings: ragSettingNames,
                selected: selectedRagSetting,
                disabled: false,
                onSelect: onRagSettingChange,
              }}
            />
          )}
        </ModelRow>
      )}

      {/* Skills selector */}
      {availableSkills && availableSkills.length > 0 && onToggleSkill && (
        <SkillSelector
          skills={availableSkills}
          activeSkillPaths={activeSkillPaths || []}
          onToggleSkill={onToggleSkill}
          disabled={isLoading}
          app={app}
        />
      )}
      {okfBundles.length > 0 && onToggleOkfBundle && (
        <OkfSelector
          bundles={okfBundles}
          activeBundleIds={activeOkfBundleIds}
          onToggleBundle={onToggleOkfBundle}
          disabled={isLoading}
        />
      )}
    </>}
    />
  );
});

export default InputArea;
