import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { TFile, Notice } from "obsidian";
import { Plus, History, Trash2 } from "lucide-react";
import type { LocalLlmHubPlugin } from "src/plugin";
import {
  type Message,
  type Attachment,
  type VaultToolMode,
  type ToolCall,
} from "src/types";
import { localLlmChatStream } from "src/core/localLlmProvider";
import { getVaultTools } from "src/core/tools";
import { executeToolCall } from "src/core/toolExecutor";
import { getRagStore } from "src/core/ragStore";
import { discoverSkills, loadSkill, buildSkillSystemPrompt, type SkillMetadata } from "src/core/skillsLoader";
import { buildErrorMessage, type ChatHistory } from "./chat/chatUtils";
import {
  messagesToMarkdown,
  parseMarkdownToMessages,
  formatHistoryDate,
} from "./chat/chatHistory";
import MessageList from "./MessageList";
import InputArea, { type InputAreaHandle } from "./InputArea";
import SkillSelector from "./SkillSelector";
import { t } from "src/i18n";
import { formatError } from "src/utils/error";

interface ChatProps {
  plugin: LocalLlmHubPlugin;
}

export default function Chat({ plugin }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [chatHistories, setChatHistories] = useState<ChatHistory[]>([]);

  const [vaultToolMode, setVaultToolMode] = useState<VaultToolMode>("all");
  const [vaultFiles, setVaultFiles] = useState<string[]>([]);
  const [hasSelection, setHasSelection] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<SkillMetadata[]>([]);
  const [activeSkillPaths, setActiveSkillPaths] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputAreaRef = useRef<InputAreaHandle>(null);
  const chatCreatedAt = useRef<number>(Date.now());

  const llmConfig = plugin.settings.llmConfig;
  const ragConfig = plugin.settings.ragConfig;
  const ragAvailable = ragConfig.enabled;

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, streamingThinking]);

  // Listen for settings updates
  useEffect(() => {
    const onSettingsUpdate = () => {
      // Re-read vault files
      refreshVaultFiles();
    };
    plugin.settingsEmitter.on("settings-updated", onSettingsUpdate);
    return () => {
      plugin.settingsEmitter.off("settings-updated", onSettingsUpdate);
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

  // Discover skills
  useEffect(() => {
    const skillsFolderPath = `${plugin.settings.workspaceFolder}/${plugin.settings.skillsFolderPath}`;
    void discoverSkills(plugin.app, skillsFolderPath).then(setAvailableSkills);
  }, [plugin]);

  const handleToggleSkill = useCallback((folderPath: string) => {
    setActiveSkillPaths(prev =>
      prev.includes(folderPath)
        ? prev.filter(p => p !== folderPath)
        : [...prev, folderPath]
    );
  }, []);

  // Check for selection
  useEffect(() => {
    const checkSelection = () => {
      const sel = plugin.getSelection();
      setHasSelection(!!sel);
    };
    const interval = setInterval(checkSelection, 2000);
    checkSelection();
    return () => clearInterval(interval);
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

    // Resolve {selection}
    if (resolved.includes("{selection}")) {
      const selection = plugin.getSelection();
      resolved = resolved.replace(/\{selection\}/g, selection || "(no selection)");
    }

    // Resolve {content}
    if (resolved.includes("{content}")) {
      const noteContent = plugin.getActiveNoteContent();
      resolved = resolved.replace(/\{content\}/g, noteContent || "(no active note)");
    }

    // Resolve file references (bare file paths from @ mentions)
    const filePathPattern = /(?:^|\s)([^\s]+\.md)(?:\s|$)/g;
    let match;
    while ((match = filePathPattern.exec(resolved)) !== null) {
      const filePath = match[1];
      const file = plugin.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        try {
          const content = await plugin.app.vault.cachedRead(file);
          resolved = resolved.replace(filePath, `From "${filePath}":\n${content}`);
        } catch {
          // File read failed, leave as-is
        }
      }
    }

    return resolved;
  }, [plugin]);

  // Save chat history
  const saveCurrentChat = useCallback(async (msgs: Message[], title?: string) => {
    if (!plugin.settings.saveChatHistory || msgs.length === 0) return;

    const chatTitle = title || generateChatTitle(msgs);
    const folder = `${plugin.settings.workspaceFolder}/chats`;

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

  // Load chat histories
  const loadChatHistories = useCallback(async () => {
    const folder = `${plugin.settings.workspaceFolder}/chats`;
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
    setMessages(history.messages);
    setCurrentChatId(history.id);
    chatCreatedAt.current = history.createdAt;
    setShowHistory(false);
  }, []);

  // Delete a chat
  const deleteChat = useCallback(async (history: ChatHistory) => {
    const folder = `${plugin.settings.workspaceFolder}/chats`;
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

  // New chat
  const newChat = useCallback(() => {
    setMessages([]);
    setCurrentChatId(null);
    setStreamingContent("");
    setStreamingThinking("");
    chatCreatedAt.current = Date.now();
    setShowHistory(false);
  }, []);

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
      await saveCurrentChat(messages, undefined);

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

      await saveCurrentChat(newMessages, undefined);
      new Notice(t("chat.compacted", { before: String(beforeCount), after: "2" }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : t("chat.unknownError");
      new Notice(t("chat.compactFailed") + ": " + msg);
    } finally {
      setIsCompacting(false);
    }
  }, [messages, isLoading, isCompacting, plugin, llmConfig, saveCurrentChat]);

  const MAX_TOOL_ROUNDS = 20;

  // Send message
  const sendMessage = useCallback(async (content: string, attachments?: Attachment[]) => {
    if (!plugin.settings.llmVerified) {
      new Notice("Please configure and verify LLM connection in settings first."); // eslint-disable-line obsidianmd/ui/sentence-case -- LLM is an acronym
      return;
    }

    const resolvedContent = await resolveMessageVariables(content);

    const userMessage: Message = {
      role: "user",
      content: resolvedContent.trim() || (attachments ? `[${attachments.length} file(s) attached]` : ""),
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

      // RAG context injection
      let ragSources: string[] | undefined;
      if (vaultToolMode === "all" && ragAvailable) {
        try {
          const store = getRagStore();
          const results = await store.search(
            resolvedContent,
            ragConfig,
            llmConfig,
            plugin.app,
            plugin.settings.workspaceFolder,
          );
          if (results.length > 0) {
            ragSources = [...new Set(results.map(r => r.filePath))];
            const ragContext = results
              .map(r => `[Source: ${r.filePath}]\n${r.text}`)
              .join("\n\n---\n\n");
            systemPrompt += `\n\nRelevant context from user's notes (use this to answer the question):\n\n${ragContext}`;
          }
        } catch (err) {
          console.warn("RAG search failed:", formatError(err));
        }
      }

      // Skill instructions injection
      let skillsUsedNames: string[] | undefined;
      if (activeSkillPaths.length > 0) {
        const activeMetadata = availableSkills.filter(s => activeSkillPaths.includes(s.folderPath));
        const loadedSkills = await Promise.all(
          activeMetadata.map(m => loadSkill(plugin.app, m))
        );
        const skillPrompt = buildSkillSystemPrompt(loadedSkills);
        if (skillPrompt) {
          systemPrompt += skillPrompt;
          skillsUsedNames = loadedSkills.map(s => s.name);
        }
      }

      // Get vault tools based on mode
      const tools = getVaultTools(vaultToolMode);

      // Conversation messages for the API (includes tool call/result messages)
      const conversationMessages: Message[] = [...messages, userMessage];
      let fullContent = "";
      let thinkingContent = "";
      let stopped = false;
      let usage: Message["usage"] | undefined;
      let toolRound = 0;

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
      while (!stopped && pendingToolCalls.length > 0 && toolRound < MAX_TOOL_ROUNDS) {
        const assistantMsg: Message = {
          role: "assistant",
          content: fullContent,
          timestamp: Date.now(),
          toolCalls: pendingToolCalls,
        };
        conversationMessages.push(assistantMsg);

        for (const tc of pendingToolCalls) {
          setStreamingContent(fullContent + `\n\n🔧 ${tc.name}...`);

          const result = await executeToolCall(tc, { app: plugin.app });
          const toolResultMsg: Message = {
            role: "tool",
            content: result.result,
            timestamp: Date.now(),
            toolCallId: tc.id,
            toolName: tc.name,
          };
          conversationMessages.push(toolResultMsg);
        }

        toolRound++;
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
        skillsUsed: skillsUsedNames,
        usage,
        elapsedMs,
      };

      // Display messages: original history + user message + final assistant message
      // (tool call/result messages are internal, not shown in UI)
      const displayMessages = [...messages, userMessage, assistantMessage];
      setMessages(displayMessages);
      setStreamingContent("");
      setStreamingThinking("");

      await saveCurrentChat(displayMessages, undefined);
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
  }, [messages, plugin, llmConfig, ragConfig, vaultToolMode, ragAvailable, resolveMessageVariables, saveCurrentChat, activeSkillPaths, availableSkills]);

  return (
    <div className="llm-hub-chat">
      {/* Header */}
      <div className="llm-hub-chat-header">
        <div className="llm-hub-header-actions">
          <button
            className="llm-hub-header-btn"
            onClick={newChat}
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

      {/* Skills selector */}
      {availableSkills.length > 0 && (
        <SkillSelector
          skills={availableSkills}
          activeSkillPaths={activeSkillPaths}
          onToggleSkill={handleToggleSkill}
          disabled={isLoading}
        />
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
        vaultToolMode={vaultToolMode}
        ragAvailable={ragAvailable}
        onVaultToolModeChange={setVaultToolMode}
        vaultFiles={vaultFiles}
        hasSelection={hasSelection}
        app={plugin.app}
        slashCommands={plugin.settings.slashCommands.map(cmd => ({
          name: cmd.name,
          description: cmd.description || "",
          promptTemplate: cmd.promptTemplate,
          vaultToolMode: cmd.vaultToolMode,
        }))}
      />
    </div>
  );
}

function generateChatTitle(messages: Message[]): string {
  const firstUserMsg = messages.find(m => m.role === "user");
  if (!firstUserMsg) return "Chat";
  const title = firstUserMsg.content.slice(0, 50).replace(/\n/g, " ").trim();
  return title || "Chat";
}
