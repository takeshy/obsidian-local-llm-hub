import { createRoot, Root } from "react-dom/client";
import { ItemView, WorkspaceLeaf, IconName } from "obsidian";
import type { LocalLlmHubPlugin } from "src/plugin";
import Chat from "./components/Chat";

export const VIEW_TYPE_LLM_CHAT = "local-llm-chat-view";

export class ChatView extends ItemView {
  plugin: LocalLlmHubPlugin;
  reactRoot!: Root;

  constructor(leaf: WorkspaceLeaf, plugin: LocalLlmHubPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_LLM_CHAT;
  }

  getDisplayText(): string {
    return "Local llm";
  }

  getIcon(): IconName {
    return "message-square";
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("llm-hub-chat-container");

    const root = createRoot(container);
    root.render(<Chat plugin={this.plugin} />);
    this.reactRoot = root;
  }

  async onClose(): Promise<void> {
    this.reactRoot?.unmount();
    await Promise.resolve();
  }
}
