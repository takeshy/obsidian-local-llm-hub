import { createRoot, Root } from "react-dom/client";
import { ItemView, WorkspaceLeaf, IconName } from "obsidian";
import type { LocalLlmHubPlugin } from "src/plugin";
import WorkflowPanel from "./components/workflow/WorkflowPanel";

export const VIEW_TYPE_WORKFLOW = "local-llm-workflow-view";

export class WorkflowView extends ItemView {
  plugin: LocalLlmHubPlugin;
  reactRoot!: Root;

  constructor(leaf: WorkspaceLeaf, plugin: LocalLlmHubPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_WORKFLOW;
  }

  getDisplayText(): string {
    return "Workflow";
  }

  getIcon(): IconName {
    return "workflow";
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("llm-hub-workflow-container");

    const root = createRoot(container);
    root.render(<WorkflowPanel plugin={this.plugin} />);
    this.reactRoot = root;
  }

  async onClose(): Promise<void> {
    this.reactRoot?.unmount();
    await Promise.resolve();
  }
}
