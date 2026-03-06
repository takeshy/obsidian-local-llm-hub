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
} from "src/types";
import { localLlmChatStream } from "src/core/localLlmProvider";
import { getRagStore } from "src/core/ragStore";
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
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [ragEnabled, setRagEnabled] = useState(false);
  const [vaultFiles, setVaultFiles] = useState<string[]>([]);
  const [hasSelection, setHasSelection] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputAreaRef = useRef<InputAreaHandle>(null);
  const chatCreatedAt = useRef<number>(Date.now());

  const llmConfig = plugin.settings.llmConfig;
  const ragConfig = plugin.settings.ragConfig;
  const thinkingAvailable = !!llmConfig.enableThinking;
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
      const allMessages = [...messages, userMessage];

      // Build system prompt
      let systemPrompt = "You are a helpful AI assistant integrated with Obsidian.";

      if (plugin.settings.systemPrompt) {
        systemPrompt += `\n\nAdditional instructions: ${plugin.settings.systemPrompt}`;
      }

      // RAG context injection
      let ragSources: string[] | undefined;
      if (ragEnabled && ragAvailable) {
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

      let fullContent = "";
      let thinkingContent = "";
      let stopped = false;
      let usage: Message["usage"] | undefined;

      for await (const chunk of localLlmChatStream(
        llmConfig,
        allMessages,
        systemPrompt,
        abortController.signal,
        thinkingAvailable && thinkingEnabled ? true : undefined,
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
          case "error":
            throw new Error(chunk.error || "Unknown error");
          case "done":
            if (chunk.usage) {
              usage = chunk.usage;
            }
            break;
        }
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
        usage,
        elapsedMs,
      };

      const newMessages = [...messages, userMessage, assistantMessage];
      setMessages(newMessages);
      setStreamingContent("");
      setStreamingThinking("");

      await saveCurrentChat(newMessages, undefined);
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
  }, [messages, plugin, llmConfig, ragConfig, ragEnabled, ragAvailable, thinkingEnabled, thinkingAvailable, resolveMessageVariables, saveCurrentChat]);

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
        isLoading={isLoading}
        thinkingEnabled={thinkingEnabled}
        thinkingAvailable={thinkingAvailable}
        onThinkingChange={setThinkingEnabled}
        ragEnabled={ragEnabled}
        ragAvailable={ragAvailable}
        onRagChange={setRagEnabled}
        vaultFiles={vaultFiles}
        hasSelection={hasSelection}
        app={plugin.app}
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
