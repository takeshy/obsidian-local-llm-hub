import { forwardRef } from "react";
import type { App } from "obsidian";
import type { Message } from "src/types";
import MessageBubble from "./MessageBubble";
import { t } from "src/i18n";

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
  streamingThinking: string;
  isLoading: boolean;
  app: App;
}

const MessageList = forwardRef<HTMLDivElement, MessageListProps>(({
  messages,
  streamingContent,
  streamingThinking,
  isLoading,
  app,
}, ref) => {
  return (
    <div className="llm-hub-messages" ref={ref}>
      {messages.length === 0 && !streamingContent && (
        <div className="llm-hub-empty-state">
          <p>{t("chat.welcomeTitle")}</p>
          <p className="llm-hub-empty-hint">
            {t("chat.welcomeHint")}
          </p>
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
