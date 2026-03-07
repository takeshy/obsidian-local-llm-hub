import { forwardRef, useImperativeHandle, useState } from "react";
import type { LocalLlmHubPlugin } from "src/plugin";
import Chat from "./Chat";
import WorkflowPanel from "./workflow/WorkflowPanel";

export type TabType = "chat" | "workflow";

export interface TabContainerRef {
  setActiveTab: (tab: TabType) => void;
}

interface TabContainerProps {
  plugin: LocalLlmHubPlugin;
}

const TabContainer = forwardRef<TabContainerRef, TabContainerProps>(
  ({ plugin }, ref) => {
    const [activeTab, setActiveTab] = useState<TabType>("chat");

    useImperativeHandle(ref, () => ({
      setActiveTab,
    }));

    return (
      <div className="llm-hub-tab-container">
        <div className="llm-hub-tab-bar">
          <button
            className={`llm-hub-tab ${activeTab === "chat" ? "active" : ""}`}
            onClick={() => setActiveTab("chat")}
          >
            Chat
          </button>
          <button
            className={`llm-hub-tab ${activeTab === "workflow" ? "active" : ""}`}
            onClick={() => setActiveTab("workflow")}
          >
            Workflow
          </button>
        </div>
        <div className="llm-hub-tab-content">
          <div className={`llm-hub-tab-panel ${activeTab === "chat" ? "is-active" : ""}`}>
            <Chat plugin={plugin} />
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
