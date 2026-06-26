import {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { TFile, Notice } from "obsidian";
import { Plus, History, Trash2, FileText, Loader2, Check } from "lucide-react";
import type { LocalLlmHubPlugin } from "src/plugin";
import {
  type Message,
  type Attachment,
  type VaultToolMode,
  type ToolCall,
  type ToolResult,
  type RagCitation,
  WORKSPACE_FOLDER,
} from "src/types";
import { localLlmChatStream } from "src/core/localLlmProvider";
import { getVaultTools, readNoteTool, skillWorkflowTool, SKILL_WORKFLOW_TOOL_NAME } from "src/core/tools";
import { EXECUTE_JAVASCRIPT_TOOL } from "src/core/sandboxExecutor";
import { executeToolCall } from "src/core/toolExecutor";
import { GET_WORKFLOW_SPEC_TOOL, GET_WORKFLOW_SPEC_TOOL_NAME, handleGetWorkflowSpec } from "src/workflow/workflowSpec";
import { getRagStore } from "src/core/ragStore";
import { discoverSkills, loadSkill, buildSkillSystemPrompt, collectSkillWorkflows, type SkillMetadata, type LoadedSkill, type SkillWorkflowRef } from "src/core/skillsLoader";
import { DEFAULT_BUILTIN_SKILL_IDS, builtinFolderPath, getBuiltinSkillMetadata, isBuiltinSkillPath } from "src/core/builtinSkills";
import { parseWorkflowFromMarkdown } from "src/workflow/parser";
import { WorkflowExecutor } from "src/workflow/executor";
import type { McpServerInfo } from "src/core/mcpManager";
import { EditConfirmationModal, promptForConfirmation } from "./workflow/EditConfirmationModal";
import { WorkflowExecutionModal } from "./workflow/WorkflowExecutionModal";
import { promptForFile, promptForAnyFile, promptForNewFilePath } from "./workflow/FilePromptModal";
import { promptForValue } from "./workflow/ValuePromptModal";
import { promptForSelection } from "./workflow/SelectionPromptModal";
import { promptForDialog } from "./workflow/DialogPromptModal";
import { cryptoCache } from "src/core/cryptoCache";
import { promptForPassword } from "src/ui/passwordPrompt";
import { buildErrorMessage, type ChatHistory } from "./chat/chatUtils";
import {
  messagesToMarkdown,
  parseMarkdownToMessages,
  formatHistoryDate,
} from "./chat/chatHistory";
import MessageList from "./MessageList";
import InputArea, { type InputAreaHandle } from "./InputArea";
import { t } from "src/i18n";
import { formatError } from "src/utils/error";
import { decodeBase64Utf8 } from "src/utils/base64";
import { findFileMentionOccurrences } from "src/utils/mentionResolver";

export interface ChatRef {
  addAttachments: (attachments: Attachment[]) => void;
  clearRag: () => void;
}

interface ChatProps {
  plugin: LocalLlmHubPlugin;
}

const Chat = forwardRef<ChatRef, ChatProps>(({ plugin }, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [chatHistories, setChatHistories] = useState<ChatHistory[]>([]);
  const [saveNoteState, setSaveNoteState] = useState<"idle" | "saving" | "saved">("idle");

  const [currentModel, setCurrentModel] = useState(plugin.settings.llmConfig.model);
  const [ragSettingNames, setRagSettingNames] = useState<string[]>(plugin.getRagSettingNames());
  const [selectedRagSetting, setSelectedRagSetting] = useState<string | null>(plugin.getSelectedRagSettingName());
  const [ragEnabled, setRagEnabled] = useState(true);
  const [vaultToolMode, setVaultToolMode] = useState<VaultToolMode>("all");
  const [vaultFiles, setVaultFiles] = useState<string[]>([]);
  const [hasSelection, setHasSelection] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<SkillMetadata[]>(getBuiltinSkillMetadata);
  const [activeSkillPaths, setActiveSkillPaths] = useState<string[]>(
    () => DEFAULT_BUILTIN_SKILL_IDS.map(builtinFolderPath)
  );
  const [mcpServerInfos, setMcpServerInfos] = useState<McpServerInfo[]>([]);
  const [enabledMcpServerIds, setEnabledMcpServerIds] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputAreaRef = useRef<InputAreaHandle>(null);
  const chatCreatedAt = useRef<number>(Date.now());
  // Set to true once user interacts (newChat, loadChat, sendMessage)
  // so the mount-time restore doesn't overwrite their action.
  const userInteractedRef = useRef(false);

  const baseLlmConfig = plugin.settings.llmConfig;
  const llmConfig = { ...baseLlmConfig, model: currentModel || baseLlmConfig.model };
  const ragAvailable = ragSettingNames.length > 0;
  const availableModels = plugin.settings.availableModels || [];

  useImperativeHandle(ref, () => ({
    addAttachments: (attachments: Attachment[]) => inputAreaRef.current?.addAttachments(attachments),
    clearRag: () => {
      setSelectedRagSetting(null);
      void plugin.selectRagSetting(null);
    },
  }));

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, streamingThinking]);

  // Listen for settings updates
  useEffect(() => {
    const onSettingsUpdate = () => {
      refreshVaultFiles();
      // Sync model if changed externally (e.g. in settings)
      setCurrentModel(plugin.settings.llmConfig.model);
      // Sync RAG settings
      setRagSettingNames(plugin.getRagSettingNames());
      setSelectedRagSetting(plugin.getSelectedRagSettingName());
    };
    const onRagChanged = () => {
      setRagSettingNames(plugin.getRagSettingNames());
      setSelectedRagSetting(plugin.getSelectedRagSettingName());
    };
    plugin.settingsEmitter.on("settings-updated", onSettingsUpdate);
    plugin.settingsEmitter.on("rag-setting-changed", onRagChanged);
    plugin.settingsEmitter.on("workspace-state-loaded", onRagChanged);
    return () => {
      plugin.settingsEmitter.off("settings-updated", onSettingsUpdate);
      plugin.settingsEmitter.off("rag-setting-changed", onRagChanged);
      plugin.settingsEmitter.off("workspace-state-loaded", onRagChanged);
    };
  }, [plugin]);

  // Listen for "send-to-chat" events (from text processing commands)
  useEffect(() => {
    const onSendToChat = (message: unknown) => {
      if (typeof message === "string") {
        inputAreaRef.current?.setInputValue(message);
        inputAreaRef.current?.focus();
      }
    };
    plugin.settingsEmitter.on("send-to-chat", onSendToChat);
    return () => {
      plugin.settingsEmitter.off("send-to-chat", onSendToChat);
    };
  }, [plugin]);

  // Load vault files
  useEffect(() => {
    refreshVaultFiles();
  }, []);

  // Restore last active chat on mount
  useEffect(() => {
    let cancelled = false;
    const lastId = plugin.lastActiveChatId;
    if (!lastId) return;

    void (async () => {
      try {
        const folder = `${WORKSPACE_FOLDER}/chats`;
        const filePath = `${folder}/${lastId}.md`;
        const file = plugin.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile) || cancelled || userInteractedRef.current) return;

        const content = await plugin.app.vault.cachedRead(file);
        if (cancelled || userInteractedRef.current) return;
        const parsed = parseMarkdownToMessages(content);
        if (parsed?.messages && parsed.messages.length > 0) {
          setMessages(parsed.messages);
          setCurrentChatId(lastId);
          chatCreatedAt.current = parsed.createdAt;
        }
      } catch (e) {
        console.warn("Failed to restore last active chat:", e);
      }
    })();

    return () => { cancelled = true; };
  }, [plugin]);

  // Sync currentChatId → plugin.lastActiveChatId (in-memory, cleared on restart)
  useEffect(() => {
    plugin.lastActiveChatId = currentChatId;
  }, [currentChatId, plugin]);

  // Discover skills (on mount + when skills-changed is emitted)
  const refreshSkills = useCallback(() => {
    void discoverSkills(plugin.app).then(setAvailableSkills);
  }, [plugin]);

  useEffect(() => {
    refreshSkills();
    plugin.settingsEmitter.on("skills-changed", refreshSkills);
    return () => {
      plugin.settingsEmitter.off("skills-changed", refreshSkills);
    };
  }, [plugin, refreshSkills]);

  // Load MCP server infos (on mount + when settings change)
  const refreshMcpServerInfos = useCallback(() => {
    const infos = plugin.mcpManager.getServerInfos();
    setMcpServerInfos(infos);
    setEnabledMcpServerIds(prev => {
      // Keep existing selections, add newly connected servers
      const next = new Set(prev);
      for (const info of infos) {
        if (!prev.has(info.id) && prev.size === 0) {
          // First load: enable all
          next.add(info.id);
        } else if (!prev.has(info.id)) {
          next.add(info.id);
        }
      }
      // Remove disconnected servers
      for (const id of next) {
        if (!infos.find(i => i.id === id)) next.delete(id);
      }
      return next;
    });
  }, [plugin]);

  useEffect(() => {
    refreshMcpServerInfos();
    plugin.settingsEmitter.on("settings-updated", refreshMcpServerInfos);
    return () => {
      plugin.settingsEmitter.off("settings-updated", refreshMcpServerInfos);
    };
  }, [plugin, refreshMcpServerInfos]);

  const handleToggleSkill = useCallback((folderPath: string) => {
    setActiveSkillPaths(prev =>
      prev.includes(folderPath)
        ? prev.filter(p => p !== folderPath)
        : [...prev, folderPath]
    );
  }, []);

  const handleModelChange = useCallback((model: string) => {
    setCurrentModel(model);
    plugin.settings.llmConfig.model = model;
    void plugin.saveSettings();
  }, [plugin]);

  const handleMcpServerToggle = useCallback((serverId: string, enabled: boolean) => {
    setEnabledMcpServerIds(prev => {
      const next = new Set(prev);
      if (enabled) {
        next.add(serverId);
      } else {
        next.delete(serverId);
      }
      return next;
    });
  }, []);

  // Check for selection
  useEffect(() => {
    const checkSelection = () => {
      const sel = plugin.getSelection();
      setHasSelection(!!sel);
    };
    const interval = window.setInterval(checkSelection, 2000);
    checkSelection();
    return () => window.clearInterval(interval);
  }, [plugin]);

  const refreshVaultFiles = useCallback(() => {
    const files = plugin.app.vault.getMarkdownFiles()
      .map(f => f.path)
      .sort();
    setVaultFiles(files);
  }, [plugin]);

  // Resolve variables in message content
  const resolveMessageVariables = useCallback(async (content: string): Promise<string> => {
    let resolved = content;

    // Resolve {selection} with location info
    if (resolved.includes("{selection}")) {
      let selectionText: string;
      const selection = plugin.getSelection();
      const locationInfo = plugin.getSelectionLocation();

      if (selection && locationInfo) {
        const lineInfo = locationInfo.startLine === locationInfo.endLine
          ? `Line ${locationInfo.startLine}`
          : `Lines ${locationInfo.startLine}-${locationInfo.endLine}`;
        const quotedSelection = selection.split("\n").map(line => `> ${line}`).join("\n");
        selectionText = `From "${locationInfo.filePath}" (${lineInfo}):\n${quotedSelection}`;
      } else if (selection) {
        selectionText = selection;
      } else {
        selectionText = "(no selection)";
      }
      resolved = resolved.replace(/\{selection\}/g, selectionText);
    }

    // Resolve {content}
    if (resolved.includes("{content}")) {
      const noteContent = plugin.getActiveNoteContent();
      resolved = resolved.replace(/\{content\}/g, noteContent || "(no active note)");
    }

    // Resolve file references (bare file paths from @ mentions). Walk actual
    // vault files (longest path first) so paths with spaces/unicode/regex
    // special chars match. The `requireWhitespaceBoundary` mode enforces that
    // matched paths stand alone as a token — this fixes a class of false
    // positives where a bare `.includes(file.path)` check would splice file
    // content into the middle of unrelated tokens like `seefoo.md` or
    // `foo.md/child` when only `foo.md` exists in the vault.
    const mdFiles = plugin.app.vault.getMarkdownFiles();
    const fileByPath = new Map<string, TFile>(mdFiles.map(f => [f.path, f]));
    const occurrences = findFileMentionOccurrences(
      resolved,
      mdFiles.map(f => f.path),
      { requireWhitespaceBoundary: true }
    );
    if (occurrences.length === 0) return resolved;

    interface Splice { start: number; end: number; replacement: string; }
    const splices: Splice[] = [];
    const hitsByPath = new Map<string, typeof occurrences>();
    for (const occ of occurrences) {
      const list = hitsByPath.get(occ.key) ?? [];
      list.push(occ);
      hitsByPath.set(occ.key, list);
    }
    for (const [path, hits] of hitsByPath) {
      const file = fileByPath.get(path);
      if (!file) continue;
      try {
        const content = await plugin.app.vault.cachedRead(file);
        const replacement = `From "${path}":\n${content}`;
        for (const h of hits) {
          splices.push({ start: h.start, end: h.end, replacement });
        }
      } catch {
        // File read failed, leave as-is.
      }
    }

    // Splice in reverse order so earlier offsets stay valid.
    splices.sort((a, b) => b.start - a.start);
    for (const s of splices) {
      resolved = resolved.slice(0, s.start) + s.replacement + resolved.slice(s.end);
    }

    return resolved;
  }, [plugin]);

  // Save chat history
  const saveCurrentChat = useCallback(async (msgs: Message[]) => {
    if (!plugin.settings.saveChatHistory || msgs.length === 0) return;

    const chatTitle = generateChatTitle(msgs);
    const folder = `${WORKSPACE_FOLDER}/chats`;

    // Ensure folder exists
    if (!plugin.app.vault.getAbstractFileByPath(folder)) {
      await plugin.app.vault.createFolder(folder);
    }

    const chatId = currentChatId || `chat-${Date.now()}`;

    const markdown = messagesToMarkdown(msgs, chatTitle, chatCreatedAt.current);
    const filePath = `${folder}/${chatId}.md`;

    const existingFile = plugin.app.vault.getAbstractFileByPath(filePath);
    if (existingFile instanceof TFile) {
      await plugin.app.vault.modify(existingFile, markdown);
    } else {
      await plugin.app.vault.create(filePath, markdown);
    }

    if (!currentChatId) {
      setCurrentChatId(chatId);
    }
  }, [currentChatId, plugin]);

  // Save current chat as a note file
  const handleSaveAsNote = useCallback(async () => {
    if (saveNoteState !== "idle" || messages.length === 0) return;
    setSaveNoteState("saving");
    try {
      const chatTitle = generateChatTitle(messages);
      const markdown = messagesToMarkdown(messages, chatTitle, chatCreatedAt.current);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const fileName = `chat-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.md`;
      await plugin.app.vault.create(fileName, markdown);
      new Notice(t("chat.savedAsNote", { path: fileName }));
      setSaveNoteState("saved");
      window.setTimeout(() => setSaveNoteState("idle"), 3000);
    } catch (error) {
      new Notice(t("common.error") + formatError(error));
      setSaveNoteState("idle");
    }
  }, [saveNoteState, messages, plugin]);

  // Load chat histories
  const loadChatHistories = useCallback(async () => {
    const folder = `${WORKSPACE_FOLDER}/chats`;
    const folderFile = plugin.app.vault.getAbstractFileByPath(folder);
    if (!folderFile) {
      setChatHistories([]);
      return;
    }

    const histories: ChatHistory[] = [];
    const files = plugin.app.vault.getMarkdownFiles()
      .filter(f => f.path.startsWith(folder + "/"))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    for (const file of files) {
      try {
        const content = await plugin.app.vault.cachedRead(file);
        const parsed = parseMarkdownToMessages(content);
        if (parsed) {
          const id = file.basename;
          const frontmatterTitle = content.match(/title:\s*"([^"]+)"/);
          const title = frontmatterTitle ? frontmatterTitle[1] : id;

          histories.push({
            id,
            title,
            messages: parsed.messages,
            createdAt: parsed.createdAt,
            updatedAt: file.stat.mtime,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }

    setChatHistories(histories);
  }, [plugin]);

  // Load a chat from history
  const loadChat = useCallback((history: ChatHistory) => {
    userInteractedRef.current = true;
    setMessages(history.messages);
    setCurrentChatId(history.id);
    chatCreatedAt.current = history.createdAt;
    setShowHistory(false);
  }, []);

  // New chat
  const newChat = useCallback(() => {
    userInteractedRef.current = true;
    setMessages([]);
    setCurrentChatId(null);
    setStreamingContent("");
    setStreamingThinking("");
    chatCreatedAt.current = Date.now();
    setShowHistory(false);
    setActiveSkillPaths(DEFAULT_BUILTIN_SKILL_IDS.map(builtinFolderPath));
  }, []);

  // Delete a chat
  const deleteChat = useCallback(async (history: ChatHistory) => {
    const folder = `${WORKSPACE_FOLDER}/chats`;
    const filePath = `${folder}/${history.id}.md`;
    const file = plugin.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await plugin.app.fileManager.trashFile(file);
    }
    if (currentChatId === history.id) {
      newChat();
    }
    await loadChatHistories();
  }, [currentChatId, plugin, loadChatHistories]);

  // Stop generation
  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // Compact conversation
  const [isCompacting, setIsCompacting] = useState(false);

  const handleCompact = useCallback(async () => {
    if (messages.length < 2 || isLoading || isCompacting) return;
    if (!plugin.settings.llmVerified) {
      new Notice(t("chat.toolsNotSupported"));
      return;
    }

    setIsCompacting(true);
    try {
      // Save current chat first
      await saveCurrentChat(messages);

      const conversationText = messages.map(msg => {
        const role = msg.role === "user" ? "User" : "Assistant";
        return `${role}: ${msg.content}`;
      }).join("\n\n");

      const summaryPrompt: Message = {
        role: "user",
        content: `Summarize the following conversation concisely. Preserve key information, decisions, file paths, and context that would be needed to continue the conversation. Output the summary in the same language as the conversation.\n\n---\n${conversationText}\n---`,
        timestamp: Date.now(),
      };

      const systemPrompt = "You are a conversation summarizer. Output only the summary without any preamble.";
      let summary = "";

      for await (const chunk of localLlmChatStream(llmConfig, [summaryPrompt], systemPrompt)) {
        if (chunk.type === "text") {
          summary += chunk.content || "";
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        } else if (chunk.type === "done") {
          break;
        }
      }

      if (!summary.trim()) {
        new Notice(t("chat.compactFailed"));
        return;
      }

      const now = Date.now();
      const beforeCount = messages.length;
      const newMessages: Message[] = [
        { role: "user", content: "/compact", timestamp: now },
        { role: "assistant", content: `[${t("chat.compactedContext")}]\n\n${summary}`, timestamp: now + 1 },
      ];

      const newChatId = `chat-${Date.now()}`;
      setCurrentChatId(newChatId);
      setMessages(newMessages);
      chatCreatedAt.current = now;

      await saveCurrentChat(newMessages);
      new Notice(t("chat.compacted", { before: String(beforeCount), after: "2" }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : t("chat.unknownError");
      new Notice(t("chat.compactFailed") + ": " + msg);
    } finally {
      setIsCompacting(false);
    }
  }, [messages, isLoading, isCompacting, plugin, llmConfig, saveCurrentChat]);

  // Decode text attachments and build context string for LLM
  const buildAttachmentContext = (atts?: Attachment[]): string => {
    if (!atts || atts.length === 0) return "";
    const sections = atts.map((att) => {
      const header = `Attachment: ${att.name} (${att.mimeType || att.type})`;
      if (att.type === "text") {
        try {
          const decoded = decodeBase64Utf8(att.data).trim();
          const content = decoded.length > 12000
            ? `${decoded.slice(0, 12000)}\n[Truncated]`
            : decoded;
          return `--- ${header} ---\n${content || "[Empty text attachment]"}\n--- End Attachment ---`;
        } catch {
          return `--- ${header} ---\n[Failed to decode]\n--- End Attachment ---`;
        }
      }
      return `--- ${header} ---\nBinary attachment metadata only.\n--- End Attachment ---`;
    });
    return `\n\nAttached files:\n\n${sections.join("\n\n")}`;
  };

  // Send message
  const sendMessage = useCallback(async (content: string, attachments?: Attachment[], skillPath?: string) => {
    userInteractedRef.current = true;
    if (!plugin.settings.llmVerified) {
      new Notice(t("chat.llmNotVerified"));
      return;
    }

    // Activate skill if specified via slash command
    if (skillPath) {
      setActiveSkillPaths(prev =>
        prev.includes(skillPath) ? prev : [...prev, skillPath]
      );
    }

    const resolvedContent = content ? await resolveMessageVariables(content) : "";

    // Determine display content for the user message
    let displayContent = resolvedContent.trim();
    if (!displayContent && skillPath) {
      const skill = availableSkills.find(s => s.folderPath === skillPath);
      displayContent = skill ? `/${skill.name}` : `/${skillPath}`;
    }
    if (!displayContent && attachments) {
      displayContent = `[${attachments.length} file(s) attached]`;
    }

    // Build LLM content including decoded text attachments
    const llmContent = `${resolvedContent}${buildAttachmentContext(attachments)}`.trim();

    const userMessage: Message = {
      role: "user",
      content: displayContent,
      llmContent: llmContent || displayContent,
      timestamp: Date.now(),
      attachments,
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setStreamingContent("");
    setStreamingThinking("");

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const startTime = Date.now();

    try {
      // Build system prompt
      let systemPrompt = "You are a helpful AI assistant integrated with Obsidian.";

      if (plugin.settings.systemPrompt) {
        systemPrompt += `\n\nAdditional instructions: ${plugin.settings.systemPrompt}`;
      }

      // RAG context injection (only when a setting is selected AND RAG is enabled for this session)
      let ragSources: string[] | undefined;
      let ragCitations: RagCitation[] | undefined;
      if (selectedRagSetting && ragEnabled) {
        const ragSetting = plugin.getRagSearchSetting(selectedRagSetting);
        if (ragSetting) {
          try {
            const store = getRagStore();
            const results = await store.search(
              selectedRagSetting,
              resolvedContent,
              ragSetting,
              llmConfig,
              plugin.app,
            );
            if (results.length > 0) {
              // Back-compat: deduped file paths for old saved chats.
              ragSources = [...new Set(results.map(r => r.filePath))];
              // New: one citation per result chunk, preserving order.
              // Only location fields are stored; `snippet` is intentionally omitted
              // because ragCitations are serialized into chat history (no note content
              // in saved chats). Tooltip preview is derived at render time from chunk text.
              ragCitations = results.map(r => ({
                filePath: r.filePath,
                ...(r.heading ? { heading: r.heading } : {}),
                startOffset: r.startOffset,
                ...(r.pageLabel ? { pageLabel: r.pageLabel } : {}),
              }));
              const ragContext = results
                .map(r => {
                  const loc = r.pageLabel
                    ? `[Source: ${r.filePath} (${r.pageLabel})]`
                    : r.heading
                      ? `[Source: ${r.filePath} > ${r.heading}]`
                      : `[Source: ${r.filePath}]`;
                  return `${loc}\n${r.text}`;
                })
                .join("\n\n---\n\n");
              systemPrompt += `\n\nRelevant context from user's notes (use this to answer the question):\n\n${ragContext}`;
            }
          } catch (err) {
            console.warn("RAG search failed:", formatError(err));
          }
        }
      }

      // Skill instructions injection (include skillPath from slash command even if state hasn't updated yet)
      let skillsUsedNames: string[] | undefined;
      let loadedSkillsList: LoadedSkill[] = [];
      const effectiveSkillPaths = skillPath && !activeSkillPaths.includes(skillPath)
        ? [...activeSkillPaths, skillPath]
        : activeSkillPaths;
      if (effectiveSkillPaths.length > 0) {
        const activeMetadata = availableSkills.filter(s => effectiveSkillPaths.includes(s.folderPath));
        loadedSkillsList = activeMetadata.map(m => loadSkill(plugin.app, m));
        const skillPrompt = buildSkillSystemPrompt(loadedSkillsList);
        if (skillPrompt) {
          systemPrompt += skillPrompt;
          skillsUsedNames = loadedSkillsList.map(s => s.name);
        }
      }

      // Get vault tools based on mode + MCP tools (MCP always available if servers enabled)
      // AnythingLLM does not support OpenAI function calling — skip tools entirely
      const isAnythingLlm = llmConfig.framework === "anythingllm";
      const vaultTools = isAnythingLlm ? [] : getVaultTools(vaultToolMode);
      const mcpTools = isAnythingLlm ? [] : plugin.mcpManager.getAllTools(
        enabledMcpServerIds.size > 0 ? Array.from(enabledMcpServerIds) : undefined,
      );
      if (isAnythingLlm && (vaultToolMode !== "none" || enabledMcpServerIds.size > 0)) {
        new Notice(t("chat.anythingLlmToolsNotSupported"));
      }
      const tools = [...vaultTools, ...mcpTools];

      // Vault skills are loaded lazily — their SKILL.md (workflow IDs,
      // inputVariables, full instructions) is only reachable via read_note.
      // If any such skill is active we must keep read_note available even
      // when vaultToolMode === "none" would otherwise strip it, or the model
      // gets neither inline workflow metadata nor the tool to fetch it.
      const hasActiveVaultSkill = loadedSkillsList.some(s => !isBuiltinSkillPath(s.folderPath));
      if (
        hasActiveVaultSkill &&
        !isAnythingLlm &&
        !tools.some(t => t.function.name === "read_note")
      ) {
        tools.push(readNoteTool);
      }

      // Add skill workflow tool if any active skill has workflows
      const skillWorkflowMap: Map<string, { skill: LoadedSkill; workflowRef: SkillWorkflowRef; vaultPath: string }> = loadedSkillsList.length > 0
        ? collectSkillWorkflows(loadedSkillsList)
        : new Map<string, { skill: LoadedSkill; workflowRef: SkillWorkflowRef; vaultPath: string }>();
      if (skillWorkflowMap.size > 0 && !isAnythingLlm) {
        tools.push(skillWorkflowTool);
      }

      // Add execute_javascript tool
      if (vaultToolMode !== "none" && !isAnythingLlm) {
        tools.push(EXECUTE_JAVASCRIPT_TOOL);
      }

      // Workflow spec lookup tool — enables the LLM to fetch authoritative
      // node docs on demand (e.g. when debugging workflows or generating YAML).
      if (!isAnythingLlm) {
        tools.push(GET_WORKFLOW_SPEC_TOOL);
      }

      // Conversation messages for the API (includes tool call/result messages)
      const conversationMessages: Message[] = [...messages, userMessage];
      let fullContent = "";
      let thinkingContent = "";
      let stopped = false;
      let usage: Message["usage"] | undefined;
      const allToolCalls: ToolCall[] = [];
      const allToolResults: ToolResult[] = [];
      // Stream one round from the LLM, returns collected tool calls
      const streamOneRound = async (useTools: boolean): Promise<ToolCall[]> => {
        const pendingToolCalls: ToolCall[] = [];
        fullContent = "";
        thinkingContent = "";

        for await (const chunk of localLlmChatStream(
          llmConfig,
          conversationMessages,
          systemPrompt,
          abortController.signal,
          useTools && tools.length > 0 ? tools : undefined,
        )) {
          if (abortController.signal.aborted) {
            stopped = true;
            break;
          }

          switch (chunk.type) {
            case "text":
              fullContent += chunk.content || "";
              setStreamingContent(fullContent);
              break;
            case "replace_text":
              fullContent = chunk.content || "";
              setStreamingContent(fullContent);
              break;
            case "thinking":
              thinkingContent += chunk.content || "";
              setStreamingThinking(thinkingContent);
              break;
            case "tool_call":
              if (chunk.toolCall) {
                pendingToolCalls.push(chunk.toolCall);
                setStreamingContent(fullContent + `\n\n🔧 ${chunk.toolCall.name}(${Object.values(chunk.toolCall.arguments).join(", ")})...`);
              }
              break;
            case "error":
              throw new Error(chunk.error || "Unknown error");
            case "done":
              if (chunk.usage) usage = chunk.usage;
              break;
          }
        }

        return pendingToolCalls;
      };

      // First round - try with tools
      let pendingToolCalls: ToolCall[];
      try {
        pendingToolCalls = await streamOneRound(tools.length > 0);
      } catch (firstError) {
        if (tools.length > 0) {
          // Tools not supported by this model - set mode to none and show notice
          new Notice(t("chat.toolsNotSupported"));
          setVaultToolMode("none");
        }
        throw firstError;
      }

      // Tool call loop: execute tools → send results → stream again
      while (!stopped && pendingToolCalls.length > 0) {
        allToolCalls.push(...pendingToolCalls);
        const assistantMsg: Message = {
          role: "assistant",
          content: fullContent,
          timestamp: Date.now(),
          toolCalls: pendingToolCalls,
        };
        conversationMessages.push(assistantMsg);

        for (const tc of pendingToolCalls) {
          setStreamingContent(fullContent + `\n\n🔧 ${tc.name}...`);

          const result = tc.name === GET_WORKFLOW_SPEC_TOOL_NAME
            ? { success: true, result: handleGetWorkflowSpec(tc.arguments, plugin) }
            : await executeToolCall(tc, {
              app: plugin.app,
              mcpManager: plugin.mcpManager,
              onProposeEdit: async (path, oldContent, newContent) => {
                const modal = new EditConfirmationModal(plugin.app, path, newContent, "overwrite", oldContent);
                const response = await modal.openAndWait();
                return response.action === "save";
              },
              onRunSkillWorkflow: skillWorkflowMap.size > 0
                ? (workflowId, variablesJson) => executeSkillWorkflow(plugin, workflowId, variablesJson, skillWorkflowMap)
                : undefined,
            });
          const toolResultMsg: Message = {
            role: "tool",
            content: result.result,
            timestamp: Date.now(),
            toolCallId: tc.id,
            toolName: tc.name,
          };
          conversationMessages.push(toolResultMsg);

          let parsedResult: unknown = result.result;
          if (tc.name === SKILL_WORKFLOW_TOOL_NAME && typeof result.result === "string") {
            const trimmed = result.result.trim();
            if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
              try {
                parsedResult = JSON.parse(trimmed);
              } catch {
                // keep raw string
              }
            }
          }
          allToolResults.push({ toolCallId: tc.id, result: parsedResult });
        }

        setStreamingContent("");
        setStreamingThinking("");

        pendingToolCalls = await streamOneRound(true);
      }

      if (stopped && fullContent) {
        fullContent += `\n\n${t("chat.generationStopped")}`;
      }

      const elapsedMs = Date.now() - startTime;

      const assistantMessage: Message = {
        role: "assistant",
        content: fullContent,
        timestamp: Date.now(),
        model: llmConfig.model || "local-llm",
        thinking: thinkingContent || undefined,
        ragUsed: !!ragSources,
        ragSources,
        ragCitations,
        skillsUsed: skillsUsedNames,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        toolResults: allToolResults.length > 0 ? allToolResults : undefined,
        usage,
        elapsedMs,
      };

      // Display messages: original history + user message + final assistant message
      // (tool call/result messages are internal, not shown in UI)
      const displayMessages = [...messages, userMessage, assistantMessage];
      setMessages(displayMessages);
      setStreamingContent("");
      setStreamingThinking("");

      await saveCurrentChat(displayMessages);
    } catch (error) {
      const errorMessage = buildErrorMessage(error);

      const assistantMessage: Message = {
        role: "assistant",
        content: errorMessage,
        timestamp: Date.now(),
        model: llmConfig.model || "local-llm",
      };

      setMessages(prev => [...prev, assistantMessage]);
      setStreamingContent("");
      setStreamingThinking("");
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [messages, plugin, llmConfig, selectedRagSetting, ragEnabled, vaultToolMode, ragAvailable, resolveMessageVariables, saveCurrentChat, activeSkillPaths, availableSkills, enabledMcpServerIds]);

  return (
    <div className="llm-hub-chat">
      {/* Header */}
      <div className="llm-hub-chat-header">
        <div className="llm-hub-header-actions">
          <button
            className="llm-hub-header-btn"
            onClick={() => { void handleSaveAsNote(); }}
            disabled={saveNoteState === "saving" || messages.length === 0}
            title={saveNoteState === "saved" ? t("chat.savedAsNote", { path: "" }) : t("chat.saveAsNote")}
          >
            {saveNoteState === "idle" && <FileText size={16} />}
            {saveNoteState === "saving" && <Loader2 size={16} className="llm-hub-spin" />}
            {saveNoteState === "saved" && <Check size={16} />}
          </button>
          <button
            className="llm-hub-header-btn"
            onClick={newChat}
            disabled={isLoading}
            title={t("chat.newChat")}
          >
            <Plus size={16} />
          </button>
          <button
            className="llm-hub-header-btn"
            onClick={() => {
              setShowHistory(!showHistory);
              if (!showHistory) {
                void loadChatHistories();
              }
            }}
            title={t("chat.history")}
          >
            <History size={16} />
          </button>
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="llm-hub-history-panel">
          {chatHistories.length === 0 ? (
            <div className="llm-hub-history-empty">{t("chat.noChats")}</div>
          ) : (
            chatHistories.map((history) => (
              <div
                key={history.id}
                className={`llm-hub-history-item ${currentChatId === history.id ? "active" : ""}`}
                onClick={() => loadChat(history)}
              >
                <div className="llm-hub-history-title">{history.title}</div>
                <div className="llm-hub-history-meta">
                  <span>{formatHistoryDate(history.updatedAt)}</span>
                  <button
                    className="llm-hub-history-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteChat(history);
                    }}
                    title={t("chat.deleteChat")}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Messages */}
      <MessageList
        ref={messagesEndRef}
        messages={messages}
        streamingContent={streamingContent}
        streamingThinking={streamingThinking}
        isLoading={isLoading}
        app={plugin.app}
      />

      {/* Input */}
      <InputArea
        ref={inputAreaRef}
        onSend={sendMessage}
        onStop={handleStop}
        onCompact={() => { void handleCompact(); }}
        isLoading={isLoading || isCompacting}
        isCompacting={isCompacting}
        messageCount={messages.length}
        currentModel={currentModel}
        availableModels={availableModels}
        onModelChange={handleModelChange}
        ragSettingNames={ragSettingNames}
        selectedRagSetting={selectedRagSetting}
        ragEnabled={ragEnabled}
        onRagToggle={setRagEnabled}
        onRagSettingChange={(setting) => {
          setSelectedRagSetting(setting);
          void plugin.selectRagSetting(setting);
        }}
        vaultToolMode={vaultToolMode}
        onVaultToolModeChange={setVaultToolMode}
        vaultFiles={vaultFiles}
        hasSelection={hasSelection}
        app={plugin.app}
        mcpServerInfos={mcpServerInfos}
        enabledMcpServerIds={enabledMcpServerIds}
        onMcpServerToggle={handleMcpServerToggle}
        availableSkills={availableSkills}
        activeSkillPaths={activeSkillPaths}
        onToggleSkill={handleToggleSkill}
        slashCommands={[
          ...plugin.settings.slashCommands.map(cmd => ({
            name: cmd.name,
            description: cmd.description || "",
            promptTemplate: cmd.promptTemplate,
            vaultToolMode: cmd.vaultToolMode,
          })),
          ...availableSkills.map(skill => ({
            name: skill.name,
            description: skill.description || t("skills.skill"),
            promptTemplate: "",
            skillPath: skill.folderPath,
          })),
        ]}
      />
    </div>
  );
});

Chat.displayName = "Chat";

export default Chat;

function generateChatTitle(messages: Message[]): string {
  const firstUserMsg = messages.find(m => m.role === "user");
  if (!firstUserMsg) return "Chat";
  const title = firstUserMsg.content.slice(0, 50).replace(/\n/g, " ").trim();
  return title || "Chat";
}

/**
 * Execute a skill workflow headlessly and return results.
 */
async function executeSkillWorkflow(
  plugin: LocalLlmHubPlugin,
  workflowId: string,
  variablesJson: string | undefined,
  skillWorkflowMap: Map<string, {
    skill: LoadedSkill;
    workflowRef: SkillWorkflowRef;
    vaultPath: string;
  }>,
): Promise<string> {
  const entry = skillWorkflowMap.get(workflowId);
  if (!entry) {
    const available = [...skillWorkflowMap.keys()].join(", ");
    return JSON.stringify({ error: `Unknown workflow ID: ${workflowId}. Available: ${available}`, workflowId });
  }

  const { vaultPath } = entry;
  const workflowDisplayName = vaultPath.substring(vaultPath.lastIndexOf("/") + 1).replace(/\.md$/, "") || workflowId;

  const file = plugin.app.vault.getAbstractFileByPath(vaultPath);
  if (!(file instanceof TFile)) {
    return JSON.stringify({ error: `Workflow file not found: ${vaultPath}`, workflowId, workflowPath: vaultPath });
  }

  const content = await plugin.app.vault.read(file);

  let workflow;
  try {
    workflow = parseWorkflowFromMarkdown(content);
  } catch (e) {
    return JSON.stringify({ error: `Failed to parse workflow: ${e instanceof Error ? e.message : String(e)}`, workflowId, workflowPath: vaultPath });
  }

  // Build input variables
  const variables = new Map<string, string | number>();
  if (variablesJson) {
    try {
      const parsed = JSON.parse(variablesJson) as Record<string, string | number>;
      for (const [key, value] of Object.entries(parsed)) {
        variables.set(key, value);
      }
    } catch {
      return JSON.stringify({ error: `Invalid variables JSON: ${variablesJson}`, workflowId, workflowPath: vaultPath });
    }
  }

  // Execute with the same execution modal as the normal workflow panel
  const executor = new WorkflowExecutor(plugin.app, plugin);
  const abortController = new AbortController();

  const modal = new WorkflowExecutionModal(
    plugin.app, workflow, workflowDisplayName, abortController, () => {},
  );
  modal.open();

  let executionModalRef: WorkflowExecutionModal | null = modal;

  const callbacks = {
    promptForFile: (defaultPath?: string) => promptForFile(plugin.app, defaultPath || "Select a file"),
    promptForAnyFile: (extensions?: string[], defaultPath?: string) =>
      promptForAnyFile(plugin.app, extensions, defaultPath || "Select a file"),
    promptForNewFilePath: (extensions?: string[], defaultPath?: string) =>
      promptForNewFilePath(plugin.app, extensions, defaultPath),
    promptForSelection: () => promptForSelection(plugin.app, "Select text"),
    promptForValue: (prompt: string, defaultValue?: string, multiline?: boolean) =>
      promptForValue(plugin.app, prompt, defaultValue || "", multiline || false),
    promptForConfirmation: (filePath: string, content: string, mode: string) =>
      promptForConfirmation(plugin.app, filePath, content, mode),
    promptForDialog: (title: string, message: string, options: string[], multiSelect: boolean, button1: string, button2?: string, markdown?: boolean, inputTitle?: string, defaults?: { input?: string; selected?: string[] }, multiline?: boolean) =>
      promptForDialog(plugin.app, title, message, options, multiSelect, button1, button2, markdown, inputTitle, defaults, multiline),
    openFile: async (notePath: string) => {
      const noteFile = plugin.app.vault.getAbstractFileByPath(notePath);
      if (noteFile instanceof TFile) {
        await plugin.app.workspace.getLeaf().openFile(noteFile);
      }
    },
    promptForPassword: async () => {
      const cached = cryptoCache.getPassword();
      if (cached) return cached;
      return promptForPassword(plugin.app);
    },
    onThinking: (nodeId: string, thinking: string) => {
      executionModalRef?.updateThinking(nodeId, thinking);
    },
  };

  try {
    const result = await executor.execute(
      workflow,
      { variables },
      (log) => executionModalRef?.updateFromLog(log),
      {
        workflowPath: vaultPath,
        workflowName: workflowDisplayName,
        recordHistory: true,
        abortSignal: abortController.signal,
      },
      callbacks,
    );

    modal.setComplete(true);

    // Collect output variables
    const outputVars: Record<string, string | number> = {};
    result.context.variables.forEach((value, key) => {
      if (!key.startsWith("__")) {
        outputVars[key] = value;
      }
    });

    const logs = result.context.logs.map(log => ({
      node: log.nodeType,
      status: log.status,
      message: log.message,
    }));

    // Extract saved files from successful note/file operations
    const fileNodeTypes = new Set(["note", "file-save"]);
    const savedFiles = result.context.logs
      .filter(log => fileNodeTypes.has(log.nodeType) && log.status === "success" && typeof log.output === "string")
      .map(log => log.output as string);

    return JSON.stringify({
      success: true,
      workflowId,
      variables: outputVars,
      logs,
      ...(savedFiles.length > 0 ? { savedFiles } : {}),
    });
  } catch (e) {
    modal.setComplete(false);
    return JSON.stringify({
      error: `Workflow execution failed: ${e instanceof Error ? e.message : String(e)}. Do not retry automatically — report the error to the user and ask how to proceed.`,
      workflowId,
      workflowPath: vaultPath,
    });
  } finally {
    executionModalRef = null;
  }
}
