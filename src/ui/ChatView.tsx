import { createRoot, Root } from "react-dom/client";
import { ItemView, WorkspaceLeaf, IconName } from "obsidian";
import type { LocalLlmHubPlugin } from "src/plugin";
import TabContainer, { type TabContainerRef, type TabType } from "./components/TabContainer";

export const VIEW_TYPE_LLM_CHAT = "local-llm-chat-view";

export class ChatView extends ItemView {
  plugin: LocalLlmHubPlugin;
  reactRoot!: Root;
  private tabContainerRef: TabContainerRef | null = null;
  private widenedSidebar: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LocalLlmHubPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_LLM_CHAT;
  }

  getDisplayText(): string {
    return "Local LLM";
  }

  getIcon(): IconName {
    return "bot";
  }

  setActiveTab(tab: TabType): void {
    this.tabContainerRef?.setActiveTab(tab);
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("llm-hub-chat-container");

    const root = createRoot(container);
    root.render(
      <TabContainer
        ref={(ref) => {
          this.tabContainerRef = ref;
        }}
        plugin={this.plugin}
        onToggleSidebarWidth={() => this.toggleSidebarWidth()}
      />
    );
    this.reactRoot = root;
  }

  async onClose(): Promise<void> {
    this.widenedSidebar?.removeClass("llm-hub-wide-sidebar");
    this.reactRoot?.unmount();
    await Promise.resolve();
  }

  private toggleSidebarWidth(): boolean {
    const sidebar = this.containerEl.closest<HTMLElement>(
      ".workspace-split.mod-left-split, .workspace-split.mod-right-split"
    );
    if (!sidebar) return false;
    sidebar.toggleClass("llm-hub-wide-sidebar", !sidebar.hasClass("llm-hub-wide-sidebar"));
    const isWide = sidebar.hasClass("llm-hub-wide-sidebar");
    this.widenedSidebar = isWide ? sidebar : null;
    window.setTimeout(() => this.leaf.onResize(), 0);
    return isWide;
  }
}
