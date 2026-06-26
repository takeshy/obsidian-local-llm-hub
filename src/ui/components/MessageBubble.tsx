import { useState, useEffect, useMemo, useRef } from "react";
import { type App, MarkdownRenderer, Component, Notice, MarkdownView } from "obsidian";
import { Copy, Check } from "lucide-react";
import type { Message, ToolCall, ToolResult, RagCitation } from "src/types";
import { discoverSkills } from "src/core/skillsLoader";
import { isBuiltinSkillPath } from "src/core/builtinSkills";
import { SKILL_WORKFLOW_TOOL_NAME } from "src/core/tools";
import { ChatView, VIEW_TYPE_LLM_CHAT } from "src/ui/ChatView";
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

  const failedWorkflowPaths = useMemo(() => {
    if (!message.toolCalls) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const tc of message.toolCalls) {
      const path = getFailedWorkflowPath(tc, message.toolResults);
      if (path) map.set(tc.id, path);
    }
    return map;
  }, [message.toolCalls, message.toolResults]);

  const noteTargets = useMemo(() => {
    if (!message.toolCalls) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const tc of message.toolCalls) {
      const target = getToolNoteTarget(app, tc, message.toolResults);
      if (target) map.set(tc.id, target);
    }
    return map;
  }, [message.toolCalls, message.toolResults, app]);


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
    window.setTimeout(() => setCopied(false), 2000);
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
          {(() => {
            // Prefer per-chunk citations; fall back to ragSources for old saved chats.
            if (message.ragCitations && message.ragCitations.length > 0) {
              return (
                <div className="llm-hub-rag-sources">
                  {message.ragCitations.map((citation, index) => (
                    <span
                      key={index}
                      className="llm-hub-rag-source"
                      title={citation.snippet}
                      onClick={() => {
                        const isPdf = citation.filePath.toLowerCase().endsWith(".pdf");
                        if (isPdf) {
                          // PDF viewer does not reliably expose scroll-to-page; just open.
                          void app.workspace.openLinkText(citation.filePath, "", false);
                        } else {
                          void scrollEditorToOffset(
                            app,
                            citation.filePath,
                            citation.heading,
                            citation.startOffset,
                          );
                        }
                      }}
                    >
                      {citationLabel(citation)}
                    </span>
                  ))}
                </div>
              );
            }
            if (message.ragSources && message.ragSources.length > 0) {
              return (
                <div className="llm-hub-rag-sources">
                  {message.ragSources.map((source, index) => (
                    <span
                      key={index}
                      className="llm-hub-rag-source"
                      title={t("message.ragCitationOpen")}
                      onClick={() => {
                        void app.workspace.openLinkText(source, "", false);
                      }}
                    >
                      {source.split("/").pop() || source}
                    </span>
                  ))}
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}

      {message.skillsUsed && message.skillsUsed.length > 0 && (
        <SkillsUsedIndicator skillNames={message.skillsUsed} app={app} />
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
        <>
          <div className="llm-hub-tools-used">
            <span className="llm-hub-tools-used-label">
              {t("message.toolsUsed")}:
            </span>
            {message.toolCalls.map((toolCall, index) => {
              const failedWorkflowPath = failedWorkflowPaths.get(toolCall.id);
              const noteTarget = noteTargets.get(toolCall.id);
              return (
                <span key={index} className="llm-hub-tool-indicator-group">
                  <span
                    className={`llm-hub-tool-name${noteTarget ? " llm-hub-tool-clickable" : ""}`}
                    onClick={() => {
                      if (noteTarget) {
                        void app.workspace.openLinkText(noteTarget, "", false).catch(() => {
                          new Notice(getToolDetail(toolCall), 3000);
                        });
                      } else {
                        new Notice(getToolDetail(toolCall), 3000);
                      }
                    }}
                    title={
                      noteTarget
                        ? t("message.clickToOpen", { source: noteTarget })
                        : t("message.clickToSeeDetails")
                    }
                  >
                    {toolCall.name}
                  </span>
                  {failedWorkflowPath && (
                    <button
                      className="llm-hub-tool-open-workflow-btn"
                      onClick={() => {
                        void openWorkflowInPanel(app, failedWorkflowPath);
                      }}
                      title={t("message.clickToOpen", { source: failedWorkflowPath })}
                    >
                      📂 {t("message.openWorkflow")}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          {failedWorkflowPaths.size > 0 && (
            <div className="llm-hub-workflow-error-hint">
              {t("message.workflowErrorHint")}
            </div>
          )}
        </>
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

function SkillsUsedIndicator({ skillNames, app }: { skillNames: string[]; app: App }) {
  const [skillMap, setSkillMap] = useState<Map<string, { path: string; builtin: boolean }>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void discoverSkills(app).then((skills) => {
      if (cancelled) return;
      const map = new Map<string, { path: string; builtin: boolean }>();
      for (const s of skills) {
        map.set(s.name, { path: s.skillFilePath, builtin: isBuiltinSkillPath(s.folderPath) });
      }
      setSkillMap(map);
    });
    return () => { cancelled = true; };
  }, [app, skillNames]);

  return (
    <div className="llm-hub-skills-used">
      <span className="llm-hub-skills-used-label">
        {t("message.skillsUsed")}:
      </span>
      {skillNames.map((skillName, index) => {
        const info = skillMap.get(skillName);
        const isBuiltin = info?.builtin ?? false;
        const isClickable = !!info && !isBuiltin;
        return (
          <span
            key={index}
            className={`llm-hub-skill-name${isClickable ? " llm-hub-tool-clickable" : " is-static"}`}
            onClick={isClickable ? () => {
              void app.workspace.openLinkText(info.path, "", false);
            } : undefined}
            title={isClickable ? t("message.clickToOpen", { source: skillName }) : skillName}
          >
            {skillName}
          </span>
        );
      })}
    </div>
  );
}

async function openWorkflowInPanel(app: App, workflowPath: string): Promise<void> {
  await app.workspace.openLinkText(workflowPath, "", false);

  const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_LLM_CHAT);
  for (const leaf of leaves) {
    const view = leaf.view;
    if (view instanceof ChatView) {
      view.setActiveTab("workflow");
      void app.workspace.revealLeaf(leaf);
    }
  }
}

/**
 * Open a Markdown file and scroll the editor to the chunk location.
 * Tries heading-line match first, then falls back to startOffset.
 * Wrapped in try/catch so a failure to scroll still opens the file.
 */
async function scrollEditorToOffset(
  app: App,
  filePath: string,
  heading: string | undefined,
  startOffset: number,
): Promise<void> {
  try {
    await app.workspace.openLinkText(filePath, "", false);
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    const editor = view.editor;
    const value = editor.getValue();

    let line = -1;
    if (heading && heading.trim().length > 0) {
      // Match a Markdown heading line whose text equals `heading`.
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const headingRe = new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, "m");
      const m = value.match(headingRe);
      if (m && m.index !== undefined) {
        line = value.slice(0, m.index).split("\n").length - 1;
      }
    }
    if (line < 0) {
      // Fallback: convert startOffset to a line number by counting newlines.
      const upTo = value.slice(0, Math.min(startOffset, value.length));
      line = upTo.split("\n").length - 1;
      if (line < 0) line = 0;
    }

    const pos = { line, ch: 0 };
    editor.setCursor(pos);
    editor.scrollIntoView({ from: pos, to: { line, ch: 0 } }, true);
  } catch (err) {
    console.warn("Local LLM Hub: failed to scroll to citation:", err);
  }
}

/** Build the display label for a citation chip. */
function citationLabel(c: RagCitation): string {
  const fileName = c.filePath.split("/").pop() || c.filePath;
  const icon = c.filePath.toLowerCase().endsWith(".pdf") ? "📄" : "📃";
  if (c.pageLabel) {
    return `${icon} ${fileName} (${c.pageLabel})`;
  }
  if (c.heading && c.heading.trim().length > 0) {
    return `${icon} ${fileName} > ${c.heading}`;
  }
  return `${icon} ${fileName}`;
}

function getFailedWorkflowPath(toolCall: ToolCall, toolResults?: ToolResult[]): string | null {
  if (toolCall.name !== SKILL_WORKFLOW_TOOL_NAME) return null;
  if (!toolResults) return null;
  const result = toolResults.find((r) => r.toolCallId === toolCall.id)?.result;
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (typeof r.error !== "string") return null;
  return typeof r.workflowPath === "string" ? r.workflowPath : null;
}

// Extract the note path/name referenced by a tool call so that clicking
// the tool tag can open that note. Returns null for tools that don't
// target a single identifiable note (search, list, bulk operations, etc.).
function getToolNoteTarget(
  app: App,
  toolCall: ToolCall,
  toolResults?: ToolResult[]
): string | null {
  // MCP tools don't reference vault notes
  if (toolCall.name.startsWith("mcp_")) return null;

  // Prefer the concrete path returned by the tool result when available,
  // since the LLM may have passed a name without folder and the executor
  // resolves it to the actual vault path.
  const result = toolResults?.find((r) => r.toolCallId === toolCall.id)?.result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.success !== false) {
      if (typeof r.path === "string" && r.path) return r.path;
      if (typeof r.newPath === "string" && r.newPath) return r.newPath;
    }
  }

  const args = toolCall.arguments;
  switch (toolCall.name) {
    case "read_note":
    case "create_note":
    case "update_note":
    case "propose_edit": {
      if (typeof args.path === "string" && args.path) return args.path;
      return null;
    }
    case "rename_note": {
      if (typeof args.newPath === "string" && args.newPath) return args.newPath;
      if (typeof args.oldPath === "string" && args.oldPath) return args.oldPath;
      return null;
    }
    case "get_active_note": {
      const active = app.workspace.getActiveFile();
      return active ? active.path : null;
    }
    default:
      return null;
  }
}

function getToolDetail(toolCall: ToolCall): string {
  const args = toolCall.arguments;
  const parts: string[] = [toolCall.name];

  // Handle MCP tools - show all arguments
  if (toolCall.name.startsWith("mcp_")) {
    const argEntries = Object.entries(args);
    if (argEntries.length > 0) {
      const argStrings = argEntries.map(([key, value]) => {
        if (typeof value === "string") {
          const displayValue = value.length > 50 ? value.slice(0, 50) + "..." : value;
          return `${key}: "${displayValue}"`;
        } else if (typeof value === "object" && value !== null) {
          return `${key}: ${JSON.stringify(value).slice(0, 50)}...`;
        }
        return `${key}: ${String(value)}`;
      });
      parts.push(argStrings.join(", "));
    }
    return parts.join("\n");
  }

  // Handle built-in tools
  if (typeof args.oldPath === "string" && typeof args.newPath === "string") {
    parts.push(args.oldPath + " → " + args.newPath);
  } else if (typeof args.path === "string") {
    parts.push(args.path);
  } else if (typeof args.query === "string") {
    parts.push(`"${args.query}"`);
  } else if (typeof args.folder === "string") {
    parts.push(args.folder);
  }

  return parts.join(": ");
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
