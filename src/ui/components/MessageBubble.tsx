import { useState, useEffect, useRef } from "react";
import { type App, MarkdownRenderer, Component } from "obsidian";
import { Copy, Check } from "lucide-react";
import type { Message } from "src/types";
import { t } from "src/i18n";

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  app: App;
}

export default function MessageBubble({
  message,
  isStreaming,
  app,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const componentRef = useRef<Component | null>(null);

  // Render markdown content using Obsidian's MarkdownRenderer
  useEffect(() => {
    if (!contentRef.current) return;

    contentRef.current.empty();

    if (componentRef.current) {
      componentRef.current.unload();
    }
    componentRef.current = new Component();
    componentRef.current.load();

    void MarkdownRenderer.render(
      app,
      message.content,
      contentRef.current,
      "/",
      componentRef.current
    ).then(() => {
      const container = contentRef.current;
      if (!container) return;

      container.querySelectorAll("a.internal-link").forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const href = link.getAttribute("href");
          if (href) {
            void app.workspace.openLinkText(href, "", false);
          }
        });
      });

      container.querySelectorAll("a.external-link").forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const href = link.getAttribute("href");
          if (href) {
            window.open(href, "_blank");
          }
        });
      });
    });

    return () => {
      if (componentRef.current) {
        componentRef.current.unload();
        componentRef.current = null;
      }
    };
  }, [message.content, app]);

  const getModelDisplayName = () => {
    if (isUser) return t("message.you");
    return message.model || t("message.assistant");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      try {
        const blob = new Blob([message.content], { type: "text/plain" });
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      } catch {
        // Both clipboard APIs unavailable — silently ignore
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`llm-hub-message ${
        isUser ? "llm-hub-message-user" : "llm-hub-message-assistant"
      } ${isStreaming ? "llm-hub-message-streaming" : ""}`}
    >
      <div className="llm-hub-message-header">
        <span className="llm-hub-message-role">
          {getModelDisplayName()}
        </span>
        <span className="llm-hub-message-time">
          {formatTime(message.timestamp)}
        </span>
        {!isStreaming && (
          <button
            className="llm-hub-copy-btn"
            onClick={() => {
              void handleCopy();
            }}
            title={t("message.copyToClipboard")}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
      </div>

      {/* RAG indicator */}
      {message.ragUsed && (
        <div className="llm-hub-rag-used">
          <span className="llm-hub-rag-indicator">
            {t("message.ragUsed")}
          </span>
          {message.ragSources && message.ragSources.length > 0 && (
            <div className="llm-hub-rag-sources">
              {message.ragSources.map((source, index) => (
                <span
                  key={index}
                  className="llm-hub-rag-source"
                  onClick={() => {
                    void app.workspace.openLinkText(source, "", false);
                  }}
                >
                  {source.split("/").pop() || source}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Skills used indicator */}
      {message.skillsUsed && message.skillsUsed.length > 0 && (
        <div className="llm-hub-skills-used">
          <span className="llm-hub-skills-used-label">
            {t("message.skillsUsed")}:
          </span>
          {message.skillsUsed.map((name, index) => (
            <span key={index} className="llm-hub-skill-name">{name}</span>
          ))}
        </div>
      )}

      {/* Attachments display */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="llm-hub-attachments">
          {message.attachments.map((attachment, index) => (
            <span key={index} className="llm-hub-attachment">
              {attachment.type === "image" && "🖼️"}
              {attachment.type === "pdf" && "📄"}
              {attachment.type === "text" && "📃"}
              {" "}{attachment.name}
            </span>
          ))}
        </div>
      )}

      {/* Tool calls indicator */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="llm-hub-tools-used">
          <span className="llm-hub-tools-used-label">
            {t("message.toolsUsed")}:
          </span>
          {[...new Set(message.toolCalls.map(tc => tc.name))].map((name, index) => (
            <span key={index} className="llm-hub-tool-name">{name}</span>
          ))}
        </div>
      )}

      {/* Thinking content (collapsible) */}
      {message.thinking && (
        <details className="llm-hub-thinking" open={isStreaming || !message.content}>
          <summary className="llm-hub-thinking-summary">
            {t("message.thinking")}
          </summary>
          <div className="llm-hub-thinking-content">
            {message.thinking}
          </div>
        </details>
      )}

      <div className="llm-hub-message-content" ref={contentRef} />

      {/* Usage info */}
      {!isUser && !isStreaming && (message.usage || message.elapsedMs) && (
        <div className="llm-hub-usage-info">
          {message.elapsedMs !== undefined && (
            <span>{formatElapsed(message.elapsedMs)}</span>
          )}
          {message.usage && message.usage.inputTokens !== undefined && message.usage.outputTokens !== undefined && (
            <span>
              {formatNumber(message.usage.inputTokens)} → {formatNumber(message.usage.outputTokens)} {t("message.tokens")}
              {message.usage.thinkingTokens ? ` (${t("message.thinkingTokens")} ${formatNumber(message.usage.thinkingTokens)})` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}
