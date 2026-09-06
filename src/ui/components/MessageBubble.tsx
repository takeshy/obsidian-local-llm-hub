import { ToolIndicator } from "obsidian-llm-hub-common";
import { MessageBubble as SharedMessageBubble, MessageContent, Attachments, UsageInfo, SourceBadges, ToolsUsed, SkillsUsed } from "obsidian-llm-hub-common";
import { useState, useEffect, useMemo, useRef } from "react";
import { type App, MarkdownRenderer, Component, Notice, MarkdownView } from "obsidian";

import type { Message, ToolCall, ToolResult, RagCitation } from "src/types";
import { discoverSkills } from "src/core/skillsLoader";
import { isBuiltinSkillPath } from "src/core/builtinSkills";
import { isRuntimeSkillPath } from "src/core/runtimeSkills";
import { SKILL_WORKFLOW_TOOL_NAME } from "src/core/tools";
import { ChatView, VIEW_TYPE_LLM_CHAT } from "src/ui/ChatView";
import { t } from "src/i18n";
import { chatLinkFileRef } from "./chat/localFileLink";
import { getReadNotePageRange } from "./toolDisplay";
import { ConfirmModal } from "./ConfirmModal";

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  app: App;
  skillsFolder?: string;
}

function openLocalFile(path: string): void {
  const electron = (window as {
    require?: (id: string) => { shell?: { openPath: (filePath: string) => Promise<string> } };
  }).require?.("electron");
  if (!electron?.shell) {
    new Notice(t("message.openLocalFileUnavailable", { path }));
    return;
  }
  void electron.shell.openPath(path).then((error) => {
    if (error) new Notice(t("message.openLocalFileFailed", { error }));
  });
}

/** Files outside the Vault are launched by the OS, so let the user see the path first. */
async function confirmAndOpenLocalFile(app: App, path: string): Promise<void> {
  const confirmed = await new ConfirmModal(
    app,
    t("message.openLocalFileConfirm", { path }),
    t("message.openLocalFileOpen"),
  ).openAndWait();
  if (confirmed) openLocalFile(path);
}

export default function MessageBubble({
  message,
  isStreaming,
  app,
  skillsFolder,
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

      const vaultBasePath = (app.vault.adapter as unknown as { basePath?: string }).basePath ?? "";

      // Treat local links under the Vault as Obsidian links. Files outside the
      // Vault are opened through the desktop shell.
      container.querySelectorAll("a[href]").forEach((link) => {
        const href = link.getAttribute("href");
        const target = href ? chatLinkFileRef(href, vaultBasePath) : null;
        if (target?.scope === "vault") {
          link.setAttribute("href", target.path);
          link.setAttribute("data-href", target.path);
          link.classList.remove("external-link");
          link.classList.add("internal-link");
          return;
        }
        if (!target) return;
        link.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          void confirmAndOpenLocalFile(app, target.path);
        });
      });

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
    <SharedMessageBubble classPrefix="llm-hub" isUser={isUser} isStreaming={isStreaming}
      roleLabel={getModelDisplayName()} timeLabel={formatTime(message.timestamp)} copied={copied}
      copyLabel={t("message.copyToClipboard")} onCopy={() => { void handleCopy(); }}>

      {/* RAG indicator */}
      {message.ragUsed && (
        <SourceBadges
          classPrefix="llm-hub"
          icon="📚"
          label={t("message.ragUsed")}
          // Prefer per-chunk citations; fall back to ragSources for old saved chats.
          sources={message.ragCitations && message.ragCitations.length > 0
            ? message.ragCitations.map((citation) => ({
              label: citationLabel(citation),
              title: t("message.ragCitationOpen"),
              onOpen: () => {
                // The PDF viewer does not reliably expose scroll-to-page; just open it.
                if (citation.filePath.toLowerCase().endsWith(".pdf")) {
                  void app.workspace.openLinkText(citation.filePath, "", false);
                } else {
                  void scrollEditorToOffset(app, citation.filePath, citation.heading, citation.startOffset);
                }
              },
            }))
            : (message.ragSources ?? []).map((source) => ({
              label: source.split("/").pop() || source,
              title: t("message.ragCitationOpen"),
              onOpen: () => {
                void app.workspace.openLinkText(source, "", false);
              },
            }))}
        />
      )}

      {message.skillsUsed && message.skillsUsed.length > 0 && (
        <SkillsUsedIndicator skillNames={message.skillsUsed} app={app} skillsFolder={skillsFolder} />
      )}

      {/* Attachments display */}
      <Attachments classPrefix="llm-hub" attachments={message.attachments} />

      {/* Tool calls indicator */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolsUsed
          classPrefix="llm-hub"
          errorHint={failedWorkflowPaths.size > 0 ? t("message.workflowErrorHint") : undefined}
        >
            {message.toolCalls.map((toolCall, index) => {
              const { icon, label } = getToolDisplayInfo(toolCall.name);
              const failedWorkflowPath = failedWorkflowPaths.get(toolCall.id);
              const noteTarget = noteTargets.get(toolCall.id);
              return (
                <ToolIndicator key={index} classPrefix="llm-hub" icon={icon} label={label}
                  detail={getToolDetail(toolCall)} onClick={() => {
                      if (noteTarget) {
                        void app.workspace.openLinkText(noteTarget, "", false).catch(() => {
                          new Notice(getToolDetail(toolCall), 3000);
                        });
                      } else {
                        new Notice(getToolDetail(toolCall), 3000);
                      }
                    }}
                  workflowAction={failedWorkflowPath ? { label: t("message.openWorkflow"), title: t("message.clickToOpen", { source: failedWorkflowPath }), onClick: () => {
                        void openWorkflowInPanel(app, failedWorkflowPath);
                      } } : undefined}
                />
              );
            })}
        </ToolsUsed>
      )}

      {/* Thinking content (collapsible) */}
      <MessageContent classPrefix="llm-hub" contentRef={contentRef} thinking={message.thinking}
        thinkingLabel={t("message.thinking")} thinkingOpen={isStreaming || !message.content} />

      {/* Usage info */}
      <UsageInfo classPrefix="llm-hub" isUser={isUser} isStreaming={isStreaming}
        elapsedMs={message.elapsedMs} usage={message.usage}
        tokensLabel={t("message.tokens")} thinkingTokensLabel={t("message.thinkingTokens")} />
    </SharedMessageBubble>
  );
}

function SkillsUsedIndicator({ skillNames, app, skillsFolder }: { skillNames: string[]; app: App; skillsFolder?: string }) {
  const [skillMap, setSkillMap] = useState<Map<string, { path: string; builtin: boolean }>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void discoverSkills(app, skillsFolder).then((skills) => {
      if (cancelled) return;
      const map = new Map<string, { path: string; builtin: boolean }>();
      for (const s of skills) {
        map.set(s.name, { path: s.skillFilePath, builtin: isBuiltinSkillPath(s.folderPath) || isRuntimeSkillPath(s.folderPath) });
      }
      setSkillMap(map);
    });
    return () => { cancelled = true; };
  }, [app, skillNames, skillsFolder]);

  return (
    <SkillsUsed
      classPrefix="llm-hub"
      label={t("message.skillsUsed")}
      skills={skillNames.map((skillName) => {
        const info = skillMap.get(skillName);
        const clickable = info && !info.builtin ? info : undefined;
        return {
          name: skillName,
          title: clickable ? t("message.clickToOpen", { source: skillName }) : skillName,
          open: clickable ? { onOpen: () => { void app.workspace.openLinkText(clickable.path, "", false); } } : undefined,
        };
      })}
    />
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
 * Prefers startOffset (most precise: maps directly to the retrieved chunk),
 * then falls back to the nearest heading if the offset is out of range
 * (e.g. the note was edited after indexing). startOffset-first avoids
 * jumping to the wrong heading when a note has duplicate heading text.
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
    // Primary: convert startOffset to a line number by counting newlines.
    if (startOffset >= 0 && startOffset <= value.length) {
      const upTo = value.slice(0, startOffset);
      line = upTo.split("\n").length - 1;
      if (line < 0) line = 0;
    }
    // Fallback: offset drifted (note edited) -> match nearest heading text.
    if (line < 0 && heading && heading.trim().length > 0) {
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const headingRe = new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, "m");
      const m = value.match(headingRe);
      if (m && m.index !== undefined) {
        line = value.slice(0, m.index).split("\n").length - 1;
      }
    }
    if (line < 0) line = 0;

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

  const args = toolCall.args;
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
  const args = toolCall.args;
  const { label } = getToolDisplayInfo(toolCall.name);
  const parts: string[] = [`${label} (${toolCall.name})`];

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

  const pageRange = getReadNotePageRange(toolCall.name, args);
  if (pageRange) parts.push(pageRange);

  return parts.join(": ");
}

function getToolDisplayInfo(toolName: string): { icon: string; label: string } {
  if (toolName.startsWith("mcp_")) {
    const parts = toolName.split("_");
    if (parts.length >= 3) {
      return { icon: "🔌", label: `${parts[1]}:${parts.slice(2).join("_")}` };
    }
    return { icon: "🔌", label: toolName.replace("mcp_", "") };
  }

  const toolDisplayMap: Record<string, { icon: string; label: string }> = {
    read_timeline: { icon: "📅", label: t("tool.readTimeline") },
    read_note: { icon: "📖", label: t("tool.read") },
    create_note: { icon: "📝", label: t("tool.created") },
    update_note: { icon: "✏️", label: t("tool.updated") },
    delete_note: { icon: "🗑️", label: t("tool.deleted") },
    rename_note: { icon: "📋", label: t("tool.renamed") },
    search_notes: { icon: "🔍", label: t("tool.searched") },
    list_notes: { icon: "📂", label: t("tool.listed") },
    list_folders: { icon: "📁", label: t("tool.listedFolders") },
    create_folder: { icon: "📁", label: t("tool.createdFolder") },
    get_active_note: { icon: "📄", label: t("tool.gotActiveNote") },
    propose_edit: { icon: "✏️", label: t("tool.editing") },
    bulk_propose_edit: { icon: "✏️", label: t("tool.editing") },
    bulk_delete_notes: { icon: "🗑️", label: t("tool.deleted") },
    bulk_rename_notes: { icon: "📋", label: t("tool.renamed") },
  };
  return toolDisplayMap[toolName] || { icon: "🔧", label: toolName };
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
