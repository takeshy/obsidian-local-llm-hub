import { forwardRef } from "react";
import type { App } from "obsidian";
import { BookOpen, LayoutDashboard, Plus } from "lucide-react";
import type { Message } from "src/types";
import MessageBubble from "./MessageBubble";
import { t } from "src/i18n";

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
  streamingThinking: string;
  isLoading: boolean;
  app: App;
  skillsFolder?: string;
  currentDashboard?: { basename: string; path: string } | null;
  onOpenDashboard?: () => void;
  onCreateDashboard?: () => void;
  onAskHelp?: () => void;
}

const MessageList = forwardRef<HTMLDivElement, MessageListProps>(({
  messages,
  streamingContent,
  streamingThinking,
  isLoading,
  app,
  skillsFolder,
  currentDashboard,
  onOpenDashboard,
  onCreateDashboard,
  onAskHelp,
}, ref) => {
  return (
    <div className="llm-hub-messages" ref={ref}>
      {messages.length === 0 && !streamingContent && (
        <div className="llm-hub-empty-state">
          <p>{t("chat.welcomeTitle")}</p>
          <p className="llm-hub-empty-hint">
            {t("chat.welcomeHint")}
          </p>
          {onAskHelp && (
            <div className="llm-hub-empty-dashboard">
              <div className="llm-hub-empty-dashboard-heading">
                <BookOpen size={16} aria-hidden="true" />
                <span>{t("chat.helpTitle")}</span>
              </div>
              <p className="llm-hub-empty-dashboard-description">{t("chat.helpDescription")}</p>
              <div className="llm-hub-empty-dashboard-actions">
                <button type="button" className="llm-hub-empty-dashboard-create" onClick={onAskHelp}>
                  <BookOpen size={14} aria-hidden="true" />
                  <span>{t("chat.askLocalLlmHubHelp")}</span>
                </button>
              </div>
            </div>
          )}
          <div className="llm-hub-empty-dashboard">
            <div className="llm-hub-empty-dashboard-heading">
              <LayoutDashboard size={16} aria-hidden="true" />
              <span>{t("chat.dashboardTitle")}</span>
            </div>
            <p className="llm-hub-empty-dashboard-description">{t("chat.dashboardDescription")}</p>
            <div className="llm-hub-empty-dashboard-actions">
              {currentDashboard && onOpenDashboard && (
                <button
                  type="button"
                  className="llm-hub-empty-dashboard-link"
                  title={currentDashboard.path}
                  onClick={onOpenDashboard}
                >
                  <LayoutDashboard size={14} aria-hidden="true" />
                  <span>{t("chat.openCurrentDashboard")}: {currentDashboard.basename}</span>
                </button>
              )}
              {onCreateDashboard && (
                <button type="button" className="llm-hub-empty-dashboard-create" onClick={onCreateDashboard}>
                  <Plus size={14} aria-hidden="true" />
                  <span>{t("chat.createDashboard")}</span>
                </button>
              )}
            </div>
          </div>
          <div className="llm-hub-empty-tips">
            <div className="llm-hub-empty-tip">
              <span>{t("chat.welcomeThinking")}</span>
            </div>
            <div className="llm-hub-empty-tip">
              <span>{t("chat.welcomeNewChat")}</span>
            </div>
          </div>
        </div>
      )}

      {messages.map((message, index) => (
        <MessageBubble
          key={index}
          message={message}
          app={app}
          skillsFolder={skillsFolder}
        />
      ))}

      {(streamingContent || streamingThinking) && (
        <MessageBubble
          message={{
            role: "assistant",
            content: streamingContent,
            timestamp: Date.now(),
            thinking: streamingThinking || undefined,
          }}
          isStreaming
          app={app}
          skillsFolder={skillsFolder}
        />
      )}

      {isLoading && !streamingContent && !streamingThinking && (
        <div className="llm-hub-loading">
          <span className="llm-hub-loading-dot" />
          <span className="llm-hub-loading-dot" />
          <span className="llm-hub-loading-dot" />
        </div>
      )}
    </div>
  );
});

export default MessageList;
