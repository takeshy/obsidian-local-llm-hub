import { forwardRef } from "react";
import { MessageList as SharedMessageList, Welcome } from "obsidian-llm-hub-chat-ui";
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
  skillsFolder?: string;
  currentDashboard?: { basename: string; path: string } | null;
  onOpenDashboard?: () => void;
  onCreateDashboard?: () => void;
  onAskHelp?: () => void;
}

const MessageList = forwardRef<HTMLDivElement, MessageListProps>((props, ref) => (
  <SharedMessageList
    classPrefix="llm-hub"
    containerRef={ref}
    messages={props.messages}
    streamingContent={props.streamingContent}
    streamingThinking={props.streamingThinking}
    isLoading={props.isLoading}
    emptyState={<Welcome
      classPrefix="llm-hub"
      cardStyle="dashboard"
      title={t("chat.welcomeTitle")} hint={t("chat.welcomeHint")}
      help={{ title: t("chat.helpTitle"), description: t("chat.helpDescription"), label: t("chat.askLocalLlmHubHelp"), onClick: props.onAskHelp }}
      dashboard={{ title: t("chat.dashboardTitle"), description: t("chat.dashboardDescription"), openLabel: t("chat.openCurrentDashboard"), createLabel: t("chat.createDashboard"), current: props.currentDashboard, onOpen: props.onOpenDashboard, onCreate: props.onCreateDashboard }}
      tips={[{ text: t("chat.welcomeThinking") }, { text: t("chat.welcomeNewChat") }]}
    />}
    renderMessage={(message) => <MessageBubble
      message={message} app={props.app} skillsFolder={props.skillsFolder}

    />}
    renderStreamingMessage={message => <MessageBubble message={message} isStreaming app={props.app} skillsFolder={props.skillsFolder} />}
  />
));
export default MessageList;
