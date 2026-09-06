import { ChatHeader } from "obsidian-llm-hub-common";
import { ChatLayout, HistoryList, HeaderButton, SidebarWidthButton, SaveNoteButton } from "obsidian-llm-hub-common";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import { TFile, Notice } from "obsidian";
import { Plus, History, Trash2 } from "lucide-react";
import type { LocalLlmHubPlugin } from "src/plugin";
import {
  type Message,
  type Attachment,
  type KnowledgeSource,
  type VaultToolMode,
  type ToolCall,
  type ToolResult,
  type RagCitation,
  WORKSPACE_FOLDER,
} from "src/types";
import { localLlmChatStream } from "src/core/localLlmProvider";
import { getVaultTools, readNoteTool, skillWorkflowTool, SKILL_WORKFLOW_TOOL_NAME } from "src/core/tools";
import { EXECUTE_JAVASCRIPT_TOOL } from "src/core/sandboxExecutor";
import { executeToolCall, type ToolExecutionResult } from "src/core/toolExecutor";
import { GET_WORKFLOW_SPEC_TOOL, GET_WORKFLOW_SPEC_TOOL_NAME, handleGetWorkflowSpec } from "src/workflow/workflowSpec";
import { getRagStore, type RagSearchResult } from "src/core/ragStore";
import {
  formatRagSearchToolResult,
  MAX_DYNAMIC_RAG_RESULTS,
  MAX_RAG_SEARCHES_PER_TURN,
  mergeRagCitations,
  RAG_SEARCH_TOOL,
  RAG_SEARCH_TOOL_NAME,
  trimRagSearchHistory,
} from "src/core/ragSearchTool";
import { discoverSkills, loadSkill, buildSkillSystemPrompt, collectSkillWorkflows, type SkillMetadata, type LoadedSkill, type SkillWorkflowRef } from "src/core/skillsLoader";
import { resolveAgentPluginMcpServers } from "src/core/agentPlugins";
import { DEFAULT_BUILTIN_SKILL_IDS, builtinFolderPath, getBuiltinSkillMetadata, isBuiltinSkillPath } from "src/core/builtinSkills";
import { buildBuiltinOkfSystemPrompt, buildOkfSystemPrompt, discoverOkfBundles, getBuiltinOkfBundle, isBuiltinOkfBundleId, type OkfBundle } from "src/core/okfLoader";
import { executeReadOkfDocumentTool, READ_OKF_DOCUMENT_TOOL, READ_OKF_DOCUMENT_TOOL_NAME } from "src/core/okfDocumentTool";
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
import { buildErrorMessage, limitConversationHistory, type ChatHistory } from "./chat/chatUtils";
import {
  messagesToMarkdown,
  messagesToCompactMarkdown,
  parseMarkdownToMessages,
  formatHistoryDate,
} from "./chat/chatHistory";
import { resolveEffectiveSkillPaths } from "./chat/contextSkills";
import { buildNoDiscoverySystemPrompt } from "./chat/noDiscoveryPrompt";
import MessageList from "./MessageList";
import InputArea, { type InputAreaHandle } from "./InputArea";
import { t } from "src/i18n";
import { formatError } from "src/utils/error";
import { decodeBase64Utf8 } from "src/utils/base64";
import { findFileMentionOccurrences } from "src/utils/mentionResolver";
import { runtimeSkillPath } from "src/core/runtimeSkills";
import { ensureAdapterFolder } from "src/core/vaultAdapter";
import { extractPdfText, formatExtractedPdfText } from "src/core/pdfText";

export interface ChatRef {
  addAttachments: (attachments: Attachment[]) => void;
  clearRag: () => void;
}

interface ChatProps {
  plugin: LocalLlmHubPlugin;
  onToggleSidebarWidth: () => boolean;
}

const DASHBOARD_SKILL_PATH = runtimeSkillPath("dashboard-hub", "dashboard");
const CONTEXT_SKILL_PATHS = new Set([DASHBOARD_SKILL_PATH]);

const Chat = forwardRef<ChatRef, ChatProps>(({ plugin, onToggleSidebarWidth }, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [maxPreviousMessages, setMaxPreviousMessages] = useState(() => {
    const saved = plugin.wsManager.workspaceState.maxPreviousMessages;
    return typeof saved === "number" ? Math.max(0, Math.min(99, Math.trunc(saved))) : 99;
  });
  const [sentPromptHistory, setSentPromptHistory] = useState<string[]>(() => {
    const saved = plugin.wsManager.workspaceState.sentPromptHistory;
    return Array.isArray(saved)
      ? saved.filter(prompt => typeof prompt === "string" && prompt.trim()).slice(-100)
      : [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [chatHistories, setChatHistories] = useState<ChatHistory[]>([]);
  const [saveNoteState, setSaveNoteState] = useState<"idle" | "saving" | "saved">("idle");
  const [isSidebarWide, setIsSidebarWide] = useState(false);
  const savedNotePathsRef = useRef(new Map<string, string>());

  const [currentModel, setCurrentModel] = useState(plugin.settings.llmConfig.model);
  const [ragSettingNames, setRagSettingNames] = useState<string[]>(plugin.getRagSettingNames());
  const [selectedRagSetting, setSelectedRagSetting] = useState<string | null>(plugin.getSelectedRagSettingName());
  const [vaultToolMode, setVaultToolMode] = useState<VaultToolMode>(plugin.settings.vaultToolMode ?? "all");
  const [vaultFiles, setVaultFiles] = useState<string[]>([]);
  const [hasSelection, setHasSelection] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<SkillMetadata[]>(getBuiltinSkillMetadata);
  const [activeSkillPaths, setActiveSkillPaths] = useState<string[]>(
    () => DEFAULT_BUILTIN_SKILL_IDS.map(builtinFolderPath)
  );
  const [okfBundles, setOkfBundles] = useState<OkfBundle[]>([]);
  const [activeOkfBundleIds, setActiveOkfBundleIds] = useState<string[]>([]);
  const [mcpServerInfos, setMcpServerInfos] = useState<McpServerInfo[]>([]);
  const [enabledMcpServerIds, setEnabledMcpServerIds] = useState<Set<string>>(() => {
    // Reconstruct the allowed set from the persisted opt-out map on mount: a server is
    // enabled UNLESS it has an explicit `false`, so absent keys keep the old default of
    // "enabled" and never flip fresh / uninitialised users onto an all-off list.
    const allowed = new Set<string>();
    for (const id of plugin.mcpManager.getServerInfos().map(info => info.id)) {
      if (plugin.settings.mcpServerEnabled?.[id] !== false) allowed.add(id);
    }
    return allowed;
  });
  const [currentDashboard, setCurrentDashboard] = useState<TFile | null>(null);
  const [activeContextSkillPath, setActiveContextSkillPath] = useState<string | null>(null);
  const [disabledContextSkillPaths, setDisabledContextSkillPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const effectiveActiveSkillPaths = useMemo(() => resolveEffectiveSkillPaths(
    activeSkillPaths,
    activeContextSkillPath,
    disabledContextSkillPaths,
    CONTEXT_SKILL_PATHS,
  ), [activeSkillPaths, activeContextSkillPath, disabledContextSkillPaths]);
  const getEffectiveSkillPathsForSend = useCallback((skillPath?: string) =>
    resolveEffectiveSkillPaths(
      activeSkillPaths,
      activeContextSkillPath,
      disabledContextSkillPaths,
      CONTEXT_SKILL_PATHS,
      skillPath,
    ), [activeSkillPaths, activeContextSkillPath, disabledContextSkillPaths]);

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
        const folder = `${plugin.settings.workspaceFolder || WORKSPACE_FOLDER}/chats`;
        const filePath = `${folder}/${lastId}.md`;
        if (!(await plugin.app.vault.adapter.exists(filePath)) || cancelled || userInteractedRef.current) return;

        const content = await plugin.app.vault.adapter.read(filePath);
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
    void discoverSkills(plugin.app, plugin.settings.skillsFolder).then(setAvailableSkills);
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
    const connectedIds = new Set(infos.map(info => info.id));
    // The persisted opt-out MAP is the single source of truth for which connected
    // servers are enabled. Absence of a key means the default (enabled), so:
    //  - fresh / first-time users (no key) keep the old "connected servers start
    //    enabled" behaviour (Bug 1: [] no longer means "disable everything");
    //  - an explicitly disabled server stays disabled even across reconnects,
    //    because the map is NOT rebuilt from connection state (Bug 2).
    const saved = plugin.settings.mcpServerEnabled || {};
    const next = new Set<string>();
    for (const id of connectedIds) {
      if (saved[id] !== false) next.add(id);
    }
    setEnabledMcpServerIds(next);
  }, [plugin]);

  useEffect(() => {
    refreshMcpServerInfos();
    plugin.settingsEmitter.on("settings-updated", refreshMcpServerInfos);
    return () => {
      plugin.settingsEmitter.off("settings-updated", refreshMcpServerInfos);
    };
  }, [plugin, refreshMcpServerInfos]);

  const handleToggleSkill = useCallback((folderPath: string) => {
    if (folderPath === activeContextSkillPath && CONTEXT_SKILL_PATHS.has(folderPath)) {
      setDisabledContextSkillPaths(prev => {
        const next = new Set(prev);
        if (next.has(folderPath)) next.delete(folderPath);
        else next.add(folderPath);
        return next;
      });
      setActiveSkillPaths(prev => prev.filter(path => !CONTEXT_SKILL_PATHS.has(path)));
      return;
    }
    if (
      activeContextSkillPath
      && !disabledContextSkillPaths.has(activeContextSkillPath)
      && CONTEXT_SKILL_PATHS.has(folderPath)
    ) return;
    setActiveSkillPaths(prev =>
      prev.includes(folderPath)
        ? prev.filter(p => p !== folderPath)
        : [...prev, folderPath]
    );
  }, [activeContextSkillPath, disabledContextSkillPaths]);

  const getOkfSource = useCallback((): KnowledgeSource | null => {
    const source = (plugin.settings.knowledgeSources || []).find(s => s.enabled && s.type === "okf" && s.path.trim());
    return source ?? null;
  }, [plugin]);

  const getOkfRoot = useCallback((): string | null => {
    return getOkfSource()?.path.trim() || null;
  }, [getOkfSource]);

  const saveActiveOkfBundleIds = useCallback((activeBundleIds: string[]) => {
    const source = getOkfSource();
    if (!source) return;
    const externalBundleIds = activeBundleIds.filter(id => !isBuiltinOkfBundleId(id));
    plugin.settings.knowledgeSources = plugin.settings.knowledgeSources.map(item =>
      item.id === source.id ? { ...item, activeBundleIds: externalBundleIds } : item
    );
    void plugin.saveSettings();
  }, [getOkfSource, plugin]);

  const refreshOkfBundles = useCallback(() => {
    const builtinBundle = getBuiltinOkfBundle();
    const source = getOkfSource();
    if (!source) {
      setOkfBundles([builtinBundle]);
      setActiveOkfBundleIds(prev => prev.filter(isBuiltinOkfBundleId));
      return;
    }
    const root = source.path.trim();
    const savedActiveBundleIds = source.activeBundleIds;
    void discoverOkfBundles(plugin.app, root)
      .then((bundles) => {
        const allBundles = [builtinBundle, ...bundles];
        setOkfBundles(allBundles);
        setActiveOkfBundleIds(prev => {
          const validIds = new Set(allBundles.map(bundle => bundle.id));
          if (savedActiveBundleIds) {
            const builtinSelection = prev.filter(isBuiltinOkfBundleId);
            return [...builtinSelection, ...savedActiveBundleIds.filter(id => validIds.has(id))];
          }
          const kept = prev.filter(id => validIds.has(id));
          return kept.length > 0 ? kept : bundles.map(bundle => bundle.id);
        });
      })
      .catch((e) => {
        console.warn("Failed to discover OKF bundles:", e);
        setOkfBundles([builtinBundle]);
        setActiveOkfBundleIds(prev => prev.filter(isBuiltinOkfBundleId));
      });
  }, [getOkfSource, plugin]);

  useEffect(() => {
    refreshOkfBundles();
    plugin.settingsEmitter.on("settings-updated", refreshOkfBundles);
    return () => {
      plugin.settingsEmitter.off("settings-updated", refreshOkfBundles);
    };
  }, [plugin, refreshOkfBundles]);

  useEffect(() => {
    const refreshDashboard = () => {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (activeFile?.extension === "dashboard") {
        setCurrentDashboard(activeFile);
        setActiveContextSkillPath(DASHBOARD_SKILL_PATH);
        return;
      }
      let openDashboard: TFile | null = null;
      plugin.app.workspace.iterateAllLeaves((leaf) => {
        const file = (leaf.view as { file?: TFile | null }).file;
        if (!openDashboard && file instanceof TFile && file.extension === "dashboard") {
          openDashboard = file;
        }
      });
      if (openDashboard) {
        setCurrentDashboard(openDashboard);
        setActiveContextSkillPath(DASHBOARD_SKILL_PATH);
        return;
      }
      const dashboards = plugin.app.vault.getFiles()
        .filter(file => file.extension === "dashboard")
        .sort((a, b) => b.stat.mtime - a.stat.mtime);
      setCurrentDashboard(dashboards[0] ?? null);
      setActiveContextSkillPath(null);
    };
    refreshDashboard();
    plugin.app.vault.on("create", refreshDashboard);
    plugin.app.vault.on("delete", refreshDashboard);
    plugin.app.vault.on("rename", refreshDashboard);
    plugin.app.workspace.on("active-leaf-change", refreshDashboard);
    return () => {
      plugin.app.vault.off("create", refreshDashboard);
      plugin.app.vault.off("delete", refreshDashboard);
      plugin.app.vault.off("rename", refreshDashboard);
      plugin.app.workspace.off("active-leaf-change", refreshDashboard);
    };
  }, [plugin]);

  const handleToggleOkfBundle = useCallback((bundleId: string) => {
    setActiveOkfBundleIds(prev => {
      const next = prev.includes(bundleId)
        ? prev.filter(id => id !== bundleId)
        : [...prev, bundleId];
      saveActiveOkfBundleIds(next);
      return next;
    });
  }, [saveActiveOkfBundleIds]);

  const handleModelChange = useCallback((model: string) => {
    setCurrentModel(model);
    plugin.settings.llmConfig.model = model;
    void plugin.saveSettings();
  }, [plugin]);

  const handleVaultToolModeChange = useCallback((mode: VaultToolMode) => {
    setVaultToolMode(mode);
    plugin.settings.vaultToolMode = mode;
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

    // Persist only explicit opt-outs. An absent key keeps the default enabled
    // behavior for new servers while false survives reloads and reconnects.
    const map = { ...(plugin.settings.mcpServerEnabled || {}) };
    if (enabled) {
      delete map[serverId];
    } else {
      map[serverId] = false;
    }
    plugin.settings.mcpServerEnabled = map;
    void plugin.saveSettings();
  }, [plugin]);

  const handleOpenDashboard = useCallback(() => {
    if (currentDashboard) void plugin.app.workspace.getLeaf(true).openFile(currentDashboard);
  }, [currentDashboard, plugin]);

  const handleCreateDashboard = useCallback(() => {
    void promptForValue(plugin.app, t("dashboard.createNamePrompt"), "Dashboard", false).then((name) => {
      if (name === null) return;
      void plugin.createDashboard(name).then((file) => {
        if (file) {
          setCurrentDashboard(file);
          setActiveContextSkillPath(DASHBOARD_SKILL_PATH);
        }
      });
    });
  }, [plugin]);

  const handleAskHelp = useCallback(() => {
    const builtinBundle = getBuiltinOkfBundle();
    setActiveOkfBundleIds(prev => prev.includes(builtinBundle.id) ? prev : [...prev, builtinBundle.id]);
    inputAreaRef.current?.setInputValue(t("chat.helpQuestionDraft"));
    inputAreaRef.current?.focus();
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
    const files = plugin.app.vault.getFiles()
      .filter(file => file.extension === "md" || file.extension === "pdf")
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

    // Tool-capable local models receive the complete vault-relative path and
    // can call read_note themselves (including choosing PDF pages). Inline
    // file text only when Vault tools are disabled or unavailable.
    const shouldInlineFileMentions = vaultToolMode === "none"
      || plugin.settings.llmConfig.framework === "anythingllm";
    if (!shouldInlineFileMentions) return resolved;

    // Resolve file references (bare file paths from @ mentions). Walk actual
    // vault files (longest path first) so paths with spaces/unicode/regex
    // special chars match. The `requireWhitespaceBoundary` mode enforces that
    // matched paths stand alone as a token — this fixes a class of false
    // positives where a bare `.includes(file.path)` check would splice file
    // content into the middle of unrelated tokens like `seefoo.md` or
    // `foo.md/child` when only `foo.md` exists in the vault.
    const mentionableFiles = plugin.app.vault.getFiles()
      .filter(file => file.extension === "md" || file.extension === "pdf");
    const fileByPath = new Map<string, TFile>(mentionableFiles.map(f => [f.path, f]));
    const occurrences = findFileMentionOccurrences(
      resolved,
      mentionableFiles.map(f => f.path),
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
        // Inlined PDFs get the same cap as read_note: a long text layer would
        // otherwise fill the whole context in the modes that inline mentions.
        let content: string;
        if (file.extension === "pdf") {
          const extracted = await extractPdfText(plugin.app, file);
          content = extracted
            ? formatExtractedPdfText(extracted)
            : "(this PDF has no extractable text — it is likely scanned or image-only)";
        } else {
          content = await plugin.app.vault.cachedRead(file);
        }
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
  }, [plugin, vaultToolMode]);

  // Save chat history
  const saveCurrentChat = useCallback(async (msgs: Message[]) => {
    if (!plugin.settings.saveChatHistory || msgs.length === 0) return;

    const chatTitle = generateChatTitle(msgs);
    const folder = `${plugin.settings.workspaceFolder || WORKSPACE_FOLDER}/chats`;

    await ensureAdapterFolder(plugin.app.vault.adapter, folder);

    const chatId = currentChatId || `chat-${Date.now()}`;

    const markdown = messagesToMarkdown(msgs, chatTitle, chatCreatedAt.current);
    const filePath = `${folder}/${chatId}.md`;

    await plugin.app.vault.adapter.write(filePath, markdown);

    const limit = Math.max(0, plugin.settings.maxSavedChatHistories);
    if (limit > 0) {
      const listed = await plugin.app.vault.adapter.list(folder);
      const files = (await Promise.all(listed.files.filter(path => path.endsWith(".md")).map(async path => ({
        path,
        stat: await plugin.app.vault.adapter.stat(path),
      })))).filter((file): file is { path: string; stat: NonNullable<typeof file.stat> } => file.stat !== null)
        .sort((a, b) => b.stat.mtime - a.stat.mtime);
      await Promise.all(files.slice(limit).map(file => plugin.app.vault.adapter.remove(file.path)));
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
      const markdown = messagesToCompactMarkdown(messages);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const dateTime = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const safeTitle = chatTitle.replace(/[\\/:*?"<>|#^[\]\r\n]+/g, " ").replace(/\s+/g, " ").replace(/^\.+|\.+$/g, "").trim().slice(0, 80) || "Chat";
      const folder = plugin.settings.manualChatSaveFolder.trim();
      if (folder) await ensureAdapterFolder(plugin.app.vault.adapter, folder);
      const chatKey = currentChatId ?? String(messages[0].timestamp);
      const newPath = `${folder ? `${folder}/` : ""}${dateTime}_${safeTitle}.md`;
      const filePath = savedNotePathsRef.current.get(chatKey) ?? newPath;
      await plugin.app.vault.adapter.write(filePath, markdown);
      savedNotePathsRef.current.set(chatKey, filePath);
      new Notice(t("chat.savedAsNote", { path: filePath }));
      setSaveNoteState("saved");
      window.setTimeout(() => setSaveNoteState("idle"), 3000);
    } catch (error) {
      new Notice(t("common.error") + formatError(error));
      setSaveNoteState("idle");
    }
  }, [saveNoteState, messages, currentChatId, plugin]);

  // Load chat histories
  const loadChatHistories = useCallback(async () => {
    const folder = `${plugin.settings.workspaceFolder || WORKSPACE_FOLDER}/chats`;
    if (!(await plugin.app.vault.adapter.exists(folder))) {
      setChatHistories([]);
      return;
    }

    const histories: ChatHistory[] = [];
    const listed = await plugin.app.vault.adapter.list(folder);
    const files = (await Promise.all(listed.files
      .filter(path => path.endsWith(".md"))
      .map(async path => ({ path, stat: await plugin.app.vault.adapter.stat(path) }))))
      .filter((file): file is { path: string; stat: NonNullable<typeof file.stat> } => file.stat !== null)
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    for (const file of files) {
      try {
        const content = await plugin.app.vault.adapter.read(file.path);
        const parsed = parseMarkdownToMessages(content);
        if (parsed) {
          const id = file.path.slice(file.path.lastIndexOf("/") + 1, -3);
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
    const folder = `${plugin.settings.workspaceFolder || WORKSPACE_FOLDER}/chats`;
    const filePath = `${folder}/${history.id}.md`;
    const file = plugin.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await plugin.app.fileManager.trashFile(file);
    } else if (await plugin.app.vault.adapter.exists(filePath)) {
      await plugin.app.vault.adapter.remove(filePath);
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
    const temporaryAgentPluginServerIds: string[] = [];

    try {
      // Build system prompt
      let systemPrompt = "You are a helpful AI assistant integrated with Obsidian.";

      if (plugin.settings.systemPrompt) {
        systemPrompt += `\n\nAdditional instructions: ${plugin.settings.systemPrompt}`;
      }

      if (activeOkfBundleIds.some(isBuiltinOkfBundleId)) {
        systemPrompt += buildBuiltinOkfSystemPrompt();
      }
      const okfRoot = getOkfRoot();
      const externalOkfBundleIds = activeOkfBundleIds.filter(id => !isBuiltinOkfBundleId(id));
      if (okfRoot && externalOkfBundleIds.length > 0) {
        systemPrompt += await buildOkfSystemPrompt(plugin.app, okfRoot, externalOkfBundleIds);
      }

      let ragSources: string[] | undefined;
      let ragCitations: RagCitation[] | undefined;
      const hasRagContext = false;
      let ragSearchCount = 0;
      const activeRagSetting = selectedRagSetting
        ? plugin.getRagSearchSetting(selectedRagSetting)
        : undefined;

      // Skill instructions injection (include skillPath from slash command even if state hasn't updated yet)
      let skillsUsedNames: string[] | undefined;
      let loadedSkillsList: LoadedSkill[] = [];
      const effectiveSkillPaths = getEffectiveSkillPathsForSend(skillPath);
      if (effectiveSkillPaths.length > 0) {
        const activeMetadata = availableSkills.filter(s => effectiveSkillPaths.includes(s.folderPath));
        loadedSkillsList = activeMetadata.map(m => loadSkill(plugin.app, m));
        const skillPrompt = buildSkillSystemPrompt(loadedSkillsList);
        if (skillPrompt) {
          systemPrompt += skillPrompt;
          skillsUsedNames = loadedSkillsList.map(s => s.name);
        }
      }

      if (vaultToolMode === "noSearch") {
        systemPrompt += buildNoDiscoverySystemPrompt({
          ragRequested: Boolean(selectedRagSetting),
          hasRagContext,
        });
      }

      // Tested Agent Plugin MCP servers are connected only for turns where a
      // skill from the same enabled package is active.
      const resolvedMcpServers = resolveAgentPluginMcpServers(plugin.settings.mcpServers, effectiveSkillPaths, plugin.settings.agentPlugins);
      for (const server of resolvedMcpServers) {
        const persisted = plugin.settings.mcpServers.find(item => item.id === server.id);
        if (!server.enabled || !server.agentPlugin || persisted?.enabled) continue;
        const result = await plugin.mcpManager.connectServer(server);
        if (result.success) temporaryAgentPluginServerIds.push(server.id);
      }

      // Get vault tools based on mode + MCP tools (MCP always available if servers enabled)
      // AnythingLLM does not support OpenAI function calling — skip tools entirely
      const isAnythingLlm = llmConfig.framework === "anythingllm";
      const vaultTools = isAnythingLlm ? [] : getVaultTools(vaultToolMode);
      const mcpTools = isAnythingLlm
        ? []
        : plugin.mcpManager.getAllTools([...enabledMcpServerIds, ...temporaryAgentPluginServerIds]);
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

      // Add execute_javascript tool, and tell the model how to reach mentioned
      // files: their content is not inlined for tool-capable models (see
      // resolveMessageVariables), so it has to fetch them itself.
      if (vaultToolMode !== "none" && !isAnythingLlm) {
        tools.push(EXECUTE_JAVASCRIPT_TOOL);
        systemPrompt += "\n\nA bare vault-relative path in the user's message (for example `folder/note.md` or `folder/document.pdf`) is a file the user referenced by mention, not a literal string. Its content is not inlined into the message. Call read_note with that exact path before answering anything that depends on it.";
      }

      // Workflow spec lookup tool — enables the LLM to fetch authoritative
      // node docs on demand (e.g. when debugging workflows or generating YAML).
      if (!isAnythingLlm) {
        tools.push(GET_WORKFLOW_SPEC_TOOL);
      }

      if (activeOkfBundleIds.length > 0 && !isAnythingLlm) {
        tools.push(READ_OKF_DOCUMENT_TOOL);
      }

      if (selectedRagSetting && activeRagSetting && !isAnythingLlm) {
        tools.push(RAG_SEARCH_TOOL);
        systemPrompt += `\n\nThe selected RAG index is available through the ${RAG_SEARCH_TOOL_NAME} tool. Use it with a self-contained, focused semantic query when the user's request may depend on indexed vault knowledge. Do not claim that the index lacks relevant information before searching it. At most ${MAX_RAG_SEARCHES_PER_TURN} RAG searches are allowed per turn; each search returns at most ${MAX_DYNAMIC_RAG_RESULTS} chunks.`;
      }

      // Conversation messages for the API (includes tool call/result messages)
      const conversationMessages: Message[] = limitConversationHistory([...trimRagSearchHistory(messages), userMessage], maxPreviousMessages);
      let fullContent = "";
      let thinkingContent = "";
      let currentRoundThinking = "";
      let stopped = false;
      let usage: Message["usage"] | undefined;
      const allToolCalls: ToolCall[] = [];
      const allToolResults: ToolResult[] = [];
      // Stream one round from the LLM, returns collected tool calls
      const streamOneRound = async (useTools: boolean): Promise<{
        toolCalls: ToolCall[];
        incompleteToolCall: boolean;
        emptyText: boolean;
      }> => {
        const pendingToolCalls: ToolCall[] = [];
        let incompleteToolCall = false;
        fullContent = "";
        currentRoundThinking = "";

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
              currentRoundThinking += chunk.content || "";
              thinkingContent += chunk.content || "";
              setStreamingThinking(thinkingContent);
              break;
            case "tool_call":
              if (chunk.toolCall) {
                pendingToolCalls.push(chunk.toolCall);
                setStreamingContent(fullContent + `\n\n🔧 ${chunk.toolCall.name}(${Object.values(chunk.toolCall.arguments).join(", ")})...`);
              }
              break;
            case "incomplete_tool_call":
              incompleteToolCall = true;
              break;
            case "error":
              throw new Error(chunk.error || "Unknown error");
            case "done":
              if (chunk.usage) usage = chunk.usage;
              break;
          }
        }

        return { toolCalls: pendingToolCalls, incompleteToolCall, emptyText: fullContent.trim().length === 0 };
      };

      const streamOneRoundWithRetry = async (useTools: boolean, retryEmptyText = false): Promise<ToolCall[]> => {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const result = await streamOneRound(useTools);
          const shouldRetry =
            result.toolCalls.length === 0 &&
            (result.incompleteToolCall || (retryEmptyText && result.emptyText));
          if (!shouldRetry) return result.toolCalls;
          console.warn(`[llm-hub] Server returned an incomplete tool continuation; retrying round (${attempt}/${maxAttempts})`);
        }
        throw new Error("The server repeatedly returned an incomplete response after a tool result.");
      };

      // First round - try with tools
      let pendingToolCalls: ToolCall[];
      try {
        pendingToolCalls = await streamOneRoundWithRetry(tools.length > 0);
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
          thinking: currentRoundThinking || undefined,
          toolCalls: pendingToolCalls,
        };
        conversationMessages.push(assistantMsg);

        for (const tc of pendingToolCalls) {
          setStreamingContent(fullContent + `\n\n🔧 ${tc.name}...`);

          const result: ToolExecutionResult = tc.name === RAG_SEARCH_TOOL_NAME
            ? await (async () => {
              if (!selectedRagSetting || !activeRagSetting) {
                return { success: false, result: "RAG is not enabled for this turn." };
              }
              if (ragSearchCount >= MAX_RAG_SEARCHES_PER_TURN) {
                return {
                  success: false,
                  result: `RAG search limit reached (${MAX_RAG_SEARCHES_PER_TURN} searches per turn).`,
                };
              }
              const query = typeof tc.arguments.query === "string" ? tc.arguments.query.trim() : "";
              if (!query) return { success: false, result: "A non-empty query is required." };

              let results: RagSearchResult[];
              try {
                results = await getRagStore().search(
                  selectedRagSetting,
                  query,
                  { ...activeRagSetting, topK: Math.min(activeRagSetting.topK, MAX_DYNAMIC_RAG_RESULTS) },
                  llmConfig,
                  plugin.app,
                );
              } catch (err) {
                // Not counted against the budget: the index was never reached.
                return { success: false, result: `RAG search failed: ${formatError(err)}` };
              }
              ragSearchCount++;
              if (results.length > 0) {
                ragSources = [...new Set([...(ragSources ?? []), ...results.map(item => item.filePath)])];
                // A refined query usually overlaps the automatic one, so the same
                // chunk must not produce a second citation.
                ragCitations = mergeRagCitations(ragCitations, results.map(item => ({
                  filePath: item.filePath,
                  ...(item.heading ? { heading: item.heading } : {}),
                  startOffset: item.startOffset,
                  ...(item.pageLabel ? { pageLabel: item.pageLabel } : {}),
                })));
              }
              return {
                success: true,
                result: formatRagSearchToolResult(
                  query,
                  results,
                  MAX_RAG_SEARCHES_PER_TURN - ragSearchCount,
                ),
              };
            })()
            : tc.name === GET_WORKFLOW_SPEC_TOOL_NAME
            ? { success: true, result: handleGetWorkflowSpec(tc.arguments, plugin) }
            : tc.name === READ_OKF_DOCUMENT_TOOL_NAME
              ? {
                success: true,
                result: JSON.stringify(await executeReadOkfDocumentTool(
                  plugin.app,
                  getOkfRoot(),
                  activeOkfBundleIds,
                  typeof tc.arguments.bundleId === "string" ? tc.arguments.bundleId : "",
                  typeof tc.arguments.path === "string" ? tc.arguments.path : "",
                )),
              }
              : await executeToolCall(tc, {
              app: plugin.app,
              mcpManager: plugin.mcpManager,
              vaultToolMode,
              vaultToolAllowedFolders: plugin.settings.vaultToolAllowedFolders,
              pdfInputMode: llmConfig.pdfInputMode === "native" && llmConfig.framework !== "ollama"
                ? "native"
                : "extract-text",
              onProposeEdit: async (path, oldContent, newContent, context) => {
                const displayPath = context?.mode === "rename" && context.targetPath
                  ? `${path} → ${context.targetPath}`
                  : path;
                const modal = new EditConfirmationModal(
                  plugin.app,
                  displayPath,
                  newContent,
                  context?.mode ?? "overwrite",
                  oldContent,
                );
                const response = await modal.openAndWait();
                if (response.action === "save") {
                  return { accepted: true, openFile: response.openFile };
                }
                if (response.action === "edit") {
                  return { accepted: false, feedback: response.content };
                }
                return { accepted: false, cancelled: true };
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
            attachments: result.attachments,
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
          allToolResults.push({ toolCallId: tc.id, result: parsedResult, attachments: result.attachments });
          if (result.cancelled) {
            stopped = true;
            break;
          }
        }

        setStreamingContent("");

        if (stopped) break;
        // A continuation with neither text nor another tool call is not a
        // useful completion. Retry it for every tool instead of maintaining a
        // partial allowlist of read tools (which omitted list_notes and
        // list_folders).
        pendingToolCalls = await streamOneRoundWithRetry(true, true);
      }

      if (stopped) {
        fullContent = fullContent
          ? `${fullContent}\n\n${t("chat.generationStopped")}`
          : t("chat.generationStopped");
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
      for (const id of temporaryAgentPluginServerIds) await plugin.mcpManager.disconnectServer(id);
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [messages, plugin, llmConfig, selectedRagSetting, vaultToolMode, ragAvailable, resolveMessageVariables, saveCurrentChat, getEffectiveSkillPathsForSend, availableSkills, enabledMcpServerIds, getOkfRoot, activeOkfBundleIds]);

  return (
    <ChatLayout classPrefix="llm-hub">
      {/* Header */}
      <ChatHeader classPrefix="llm-hub" >
          <SidebarWidthButton
            classPrefix="llm-hub"
            wide={isSidebarWide}
            title={isSidebarWide ? t("chat.narrowSidebar") : t("chat.widenSidebar")}
            onClick={() => setIsSidebarWide(onToggleSidebarWidth())}
          />
          <SaveNoteButton
            classPrefix="llm-hub"
            state={saveNoteState}
            disabled={messages.length === 0}
            title={saveNoteState === "saved" ? t("chat.savedAsNote", { path: "" }) : t("chat.saveAsNote")}
            onClick={() => { void handleSaveAsNote(); }}
          />
          <HeaderButton classPrefix="llm-hub" title={t("chat.newChat")} disabled={isLoading} onClick={newChat}>
            <Plus size={16} />
          </HeaderButton>
          <HeaderButton
            classPrefix="llm-hub"
            title={t("chat.history")}
            onClick={() => {
              setShowHistory(!showHistory);
              if (!showHistory) {
                void loadChatHistories();
              }
            }}
          >
            <History size={16} />
          </HeaderButton>
        </ChatHeader>

      {/* History panel */}
      {showHistory && <HistoryList classPrefix="llm-hub"
        entries={chatHistories.map(history => ({ ...history, dateLabel: formatHistoryDate(history.updatedAt) }))}
        currentId={currentChatId} emptyLabel={t("chat.noChats")} deleteLabel={t("chat.deleteChat")}
        onSelect={history => { void loadChat(history); }}
        onDelete={(history) => { void deleteChat(history); }}
        panel deleteIcon={<Trash2 size={12} />}

      />}

      {/* Messages */}
      <MessageList
        ref={messagesEndRef}
        messages={messages}
        streamingContent={streamingContent}
        streamingThinking={streamingThinking}
        isLoading={isLoading}
        app={plugin.app}
        skillsFolder={plugin.settings.skillsFolder}
        currentDashboard={currentDashboard ? {
          basename: currentDashboard.basename,
          path: currentDashboard.path,
        } : null}
        onOpenDashboard={currentDashboard ? handleOpenDashboard : undefined}
        onCreateDashboard={handleCreateDashboard}
        onAskHelp={handleAskHelp}
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
        ragSearchAvailable={llmConfig.framework !== "anythingllm"}
        onRagSettingChange={(setting) => {
          setSelectedRagSetting(setting);
          void plugin.selectRagSetting(setting);
        }}
        vaultToolMode={vaultToolMode}
        onVaultToolModeChange={handleVaultToolModeChange}
        vaultFiles={vaultFiles}
        hasSelection={hasSelection}
        app={plugin.app}
        mcpServerInfos={mcpServerInfos}
        enabledMcpServerIds={enabledMcpServerIds}
        onMcpServerToggle={handleMcpServerToggle}
        availableSkills={availableSkills}
        activeSkillPaths={effectiveActiveSkillPaths}
        onToggleSkill={handleToggleSkill}
        okfBundles={okfBundles}
        activeOkfBundleIds={activeOkfBundleIds}
        onToggleOkfBundle={handleToggleOkfBundle}
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
        maxPreviousMessages={maxPreviousMessages}
        onMaxPreviousMessagesChange={(count) => {
          setMaxPreviousMessages(count);
          plugin.wsManager.workspaceState.maxPreviousMessages = count;
          void plugin.wsManager.saveWorkspaceState();
        }}
        inputHistory={sentPromptHistory}
        onInputHistoryAdd={(prompt) => {
          setSentPromptHistory(previous => {
            const next = [...previous, prompt].slice(-100);
            plugin.wsManager.workspaceState.sentPromptHistory = next;
            void plugin.wsManager.saveWorkspaceState();
            return next;
          });
        }}
      />
    </ChatLayout>
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
        vaultToolAllowedFolders: plugin.settings.vaultToolAllowedFolders,
        workflowDefinitionRoot: entry.skill.folderPath,
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
