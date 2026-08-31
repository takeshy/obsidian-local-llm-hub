import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import type { LocalLlmHubPlugin } from "src/plugin";
import type { Attachment } from "src/types";
import Chat, { type ChatRef } from "./Chat";
import SearchPanel from "./SearchPanel";
import WorkflowPanel from "./workflow/WorkflowPanel";
import { t } from "src/i18n";

export type TabType = "chat" | "search" | "workflow";

export interface TabContainerRef {
  setActiveTab: (tab: TabType) => void;
}

interface TabContainerProps {
  plugin: LocalLlmHubPlugin;
  onToggleSidebarWidth: () => boolean;
}

const TabContainer = forwardRef<TabContainerRef, TabContainerProps>(
  ({ plugin, onToggleSidebarWidth }, ref) => {
    const [activeTab, setActiveTab] = useState<TabType>("chat");
    const chatRef = useRef<ChatRef>(null);

    useImperativeHandle(ref, () => ({
      setActiveTab,
    }));

    const handleChatWithResults = useCallback((attachments: Attachment[]) => {
      chatRef.current?.addAttachments(attachments);
      chatRef.current?.clearRag();
      setActiveTab("chat");
    }, []);

    return (
      <div className="llm-hub-tab-container">
        <div className="llm-hub-tab-bar">
          <button
            className={`llm-hub-tab ${activeTab === "chat" ? "active" : ""}`}
            onClick={() => setActiveTab("chat")}
          >
            {t("tab.chat")}
          </button>
          <button
            className={`llm-hub-tab ${activeTab === "search" ? "active" : ""}`}
            onClick={() => setActiveTab("search")}
          >
            {t("search.tab")}
          </button>
          <button
            className={`llm-hub-tab ${activeTab === "workflow" ? "active" : ""}`}
            onClick={() => setActiveTab("workflow")}
          >
            {t("tab.workflowSkill")}
          </button>
        </div>
        <div className="llm-hub-tab-content">
          <div className={`llm-hub-tab-panel ${activeTab === "chat" ? "is-active" : ""}`}>
            <Chat ref={chatRef} plugin={plugin} onToggleSidebarWidth={onToggleSidebarWidth} />
          </div>
          <div className={`llm-hub-tab-panel ${activeTab === "search" ? "is-active" : ""}`}>
            <SearchPanel plugin={plugin} onChatWithResults={handleChatWithResults} />
          </div>
          <div className={`llm-hub-tab-panel ${activeTab === "workflow" ? "is-active" : ""}`}>
            <WorkflowPanel plugin={plugin} />
          </div>
        </div>
      </div>
    );
  }
);

TabContainer.displayName = "TabContainer";

export default TabContainer;
