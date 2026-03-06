import { App, Modal, Setting } from "obsidian";
import type { ObsidianEventType, WorkflowEventTrigger } from "src/types";
import { t } from "src/i18n";

const EVENT_LABELS: Record<ObsidianEventType, { name: string; desc: string }> = {
  create: { name: "File Created", desc: "Triggered when a new file is created" },
  modify: { name: "File Modified", desc: "Triggered when a file is saved" },
  delete: { name: "File Deleted", desc: "Triggered when a file is deleted" },
  rename: { name: "File Renamed", desc: "Triggered when a file is renamed" },
  "file-open": { name: "File Opened", desc: "Triggered when a file is opened" },
};

const ALL_EVENTS: ObsidianEventType[] = ["create", "modify", "delete", "rename", "file-open"];

export class EventTriggerModal extends Modal {
  private workflowId: string;
  private workflowName: string;
  private currentTrigger: WorkflowEventTrigger | null;
  private onSave: (trigger: WorkflowEventTrigger | null) => void;

  private selectedEvents: Set<ObsidianEventType>;
  private filePattern: string;

  constructor(
    app: App,
    workflowId: string,
    workflowName: string,
    currentTrigger: WorkflowEventTrigger | null,
    onSave: (trigger: WorkflowEventTrigger | null) => void
  ) {
    super(app);
    this.workflowId = workflowId;
    this.workflowName = workflowName;
    this.currentTrigger = currentTrigger;
    this.onSave = onSave;

    this.selectedEvents = new Set(currentTrigger?.events || []);
    this.filePattern = currentTrigger?.filePattern || "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-hub-workflow-event-trigger-modal");

    contentEl.createEl("h2", {
      text: t("workflow.eventTriggers", { name: this.workflowName }),
    });

    contentEl.createEl("p", {
      text: t("workflow.eventTriggersDesc"),
      cls: "setting-item-description",
    });

    for (const eventType of ALL_EVENTS) {
      const info = EVENT_LABELS[eventType];
      new Setting(contentEl)
        .setName(info.name)
        .setDesc(info.desc)
        .addToggle((toggle) => {
          toggle.setValue(this.selectedEvents.has(eventType));
          toggle.onChange((value) => {
            if (value) {
              this.selectedEvents.add(eventType);
            } else {
              this.selectedEvents.delete(eventType);
            }
          });
        });
    }

    new Setting(contentEl)
      .setName(t("workflow.filePattern"))
      .setDesc(t("workflow.filePatternDesc"))
      .addText((text) => {
        text.setPlaceholder("**/*.md");
        text.setValue(this.filePattern);
        text.onChange((value) => {
          this.filePattern = value;
        });
      });

    const buttonContainer = contentEl.createDiv({ cls: "llm-hub-workflow-modal-buttons" });

    const saveBtn = buttonContainer.createEl("button", {
      cls: "mod-cta",
      text: t("common.save"),
    });
    saveBtn.addEventListener("click", () => this.save());

    if (this.currentTrigger) {
      const removeBtn = buttonContainer.createEl("button", {
        cls: "mod-warning",
        text: t("workflow.removeAllTriggers"),
      });
      removeBtn.addEventListener("click", () => this.remove());
    }

    const cancelBtn = buttonContainer.createEl("button", {
      text: t("common.cancel"),
    });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private save(): void {
    if (this.selectedEvents.size === 0) {
      this.onSave(null);
    } else {
      const trigger: WorkflowEventTrigger = {
        workflowId: this.workflowId,
        events: Array.from(this.selectedEvents),
        filePattern: this.filePattern || undefined,
      };
      this.onSave(trigger);
    }
    this.close();
  }

  private remove(): void {
    this.onSave(null);
    this.close();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
