import { App, Modal, MarkdownRenderer, Component } from "obsidian";
import type { StreamChunkUsage } from "src/types";
import { createCopyButton } from "src/utils/copyButton";
import { t } from "src/i18n";

export interface WorkflowGenerationResult {
  response: string;
  cancelled: boolean;
}

export type GenerationPhase = "planning" | "generating" | "reviewing";

export interface PlanConfirmResult {
  action: "ok" | "replan" | "cancel";
  feedback?: string;
}

export interface ReviewConfirmResult {
  action: "ok" | "refine" | "cancel";
}

export class WorkflowGenerationModal extends Modal {
  private request: string;
  private modelDisplayName: string;
  private currentPhase: GenerationPhase = "generating";
  private planningEnabled: boolean;
  private phaseIndicatorEl: HTMLElement | null = null;
  private planSectionEl: HTMLElement | null = null;
  private planContainerEl: HTMLElement | null = null;
  private thinkingSectionEl: HTMLElement | null = null;
  private thinkingContainerEl: HTMLElement | null = null;
  private pendingThinkingSeparator: string | null = null;
  private reviewSectionEl: HTMLElement | null = null;
  private reviewContainerEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private abortController: AbortController;
  private onCancel: () => void;
  private isCancelled = false;
  private executionStepsCount: number;
  private thinkingText = "";
  private reviewText = "";
  private planText = "";
  private markdownComponent: Component | null = null;

  constructor(
    app: App,
    request: string,
    abortController: AbortController,
    onCancel: () => void,
    executionStepsCount = 0,
    modelDisplayName = "",
    planningEnabled = false
  ) {
    super(app);
    this.request = request;
    this.abortController = abortController;
    this.onCancel = onCancel;
    this.executionStepsCount = executionStepsCount;
    this.modelDisplayName = modelDisplayName;
    this.planningEnabled = planningEnabled;
  }

  onOpen(): void {
    const { contentEl, modalEl, containerEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-hub-workflow-generation-modal-content");
    modalEl.addClass("llm-hub-workflow-generation-modal");
    modalEl.addClass("llm-hub-modal-resizable");

    // Prevent closing on outside click
    containerEl.addEventListener("click", (e) => {
      if (e.target === containerEl) {
        e.stopPropagation();
        e.preventDefault();
      }
    });

    // Drag handle with title
    const dragHandle = contentEl.createDiv({ cls: "modal-drag-handle" });
    const titleEl = dragHandle.createEl("h2", { text: t("workflow.generation.title") });
    // Show model name in title if available
    if (this.modelDisplayName) {
      titleEl.createSpan({
        cls: "llm-hub-workflow-generation-model-badge",
        text: this.modelDisplayName,
      });
    }
    this.setupDragHandle(dragHandle, modalEl);

    // User's request section
    const requestSection = contentEl.createDiv({ cls: "llm-hub-workflow-generation-request" });
    requestSection.createEl("h3", { text: t("workflow.generation.yourRequest") });
    const requestContent = requestSection.createDiv({ cls: "llm-hub-workflow-generation-request-content" });
    requestContent.textContent = this.request;

    // Execution history info (if steps are selected)
    if (this.executionStepsCount > 0) {
      const historySection = contentEl.createDiv({ cls: "llm-hub-workflow-generation-history-info" });
      historySection.createSpan( {
        cls: "llm-hub-workflow-generation-history-badge",
        text: t("workflow.generation.executionHistoryIncluded", { count: this.executionStepsCount }),
      });
    }

    this.phaseIndicatorEl = contentEl.createDiv({ cls: "llm-hub-workflow-generation-phase-indicator" });
    this.renderPhaseIndicator();

    this.planSectionEl = contentEl.createDiv({
      cls: `llm-hub-workflow-generation-plan-section${this.planningEnabled ? "" : " is-hidden"}`,
    });
    const planHeader = this.planSectionEl.createDiv({ cls: "llm-hub-workflow-generation-section-header" });
    planHeader.createEl("h3", { text: t("workflow.generation.planning") });
    this.planContainerEl = this.planSectionEl.createDiv({ cls: "llm-hub-workflow-generation-plan" });

    // Hidden until the model emits real thinking content — models without
    // reasoning output would otherwise show an empty panel with just phase
    // separators.
    const thinkingDetails = contentEl.createEl("details", {
      cls: "llm-hub-workflow-generation-thinking-details is-hidden",
    });
    const thinkingSummary = thinkingDetails.createEl("summary", { cls: "llm-hub-thinking-summary" });
    thinkingSummary.createSpan({ text: t("workflow.generation.thinking") });
    createCopyButton(thinkingSummary, () => this.thinkingText);
    this.thinkingSectionEl = thinkingDetails;
    this.thinkingContainerEl = thinkingDetails.createEl("pre", {
      cls: "llm-hub-thinking-content llm-hub-workflow-generation-thinking",
    });

    this.reviewSectionEl = contentEl.createDiv({ cls: "llm-hub-workflow-generation-review-section is-hidden" });
    const reviewHeader = this.reviewSectionEl.createDiv({ cls: "llm-hub-workflow-generation-section-header" });
    reviewHeader.createEl("h3", { text: t("workflow.generation.reviewing") });
    this.reviewContainerEl = this.reviewSectionEl.createDiv({ cls: "llm-hub-workflow-generation-review" });

    // Status indicator
    this.statusEl = contentEl.createDiv({ cls: "llm-hub-workflow-generation-status" });
    this.updateStatusText();

    // Add loading animation
    const loadingDotsEl = this.statusEl.createSpan({ cls: "llm-hub-workflow-generation-loading-dots" });
    loadingDotsEl.createSpan({ cls: "dot" });
    loadingDotsEl.createSpan({ cls: "dot" });
    loadingDotsEl.createSpan({ cls: "dot" });

    // Cancel button
    const buttonContainer = contentEl.createDiv({ cls: "llm-hub-workflow-generation-buttons" });
    this.cancelBtn = buttonContainer.createEl("button", {
      text: t("common.cancel"),
      cls: "mod-warning",
    });
    this.cancelBtn.addEventListener("click", () => {
      this.cancel();
    });
  }

  private renderPhaseIndicator(): void {
    if (!this.phaseIndicatorEl) return;
    this.phaseIndicatorEl.empty();

    const phases: { key: GenerationPhase; label: string }[] = [
      ...(this.planningEnabled ? [{ key: "planning" as GenerationPhase, label: t("workflow.generation.phasePlan") }] : []),
      { key: "generating", label: t("workflow.generation.phaseGenerate") },
      { key: "reviewing", label: t("workflow.generation.phaseReview") },
    ];

    for (const phase of phases) {
      const stepEl = this.phaseIndicatorEl.createSpan({ cls: "llm-hub-workflow-generation-phase-step" });
      if (phase.key === this.currentPhase) {
        stepEl.addClass("is-active");
      } else if (this.getPhaseOrder(phase.key) < this.getPhaseOrder(this.currentPhase)) {
        stepEl.addClass("is-completed");
      }
      stepEl.textContent = phase.label;
    }
  }

  private getPhaseOrder(phase: GenerationPhase): number {
    const order: Record<GenerationPhase, number> = { planning: 0, generating: 1, reviewing: 2 };
    return order[phase];
  }

  setPhase(phase: GenerationPhase): void {
    this.currentPhase = phase;
    this.renderPhaseIndicator();
    this.updateStatusText();
    this.contentEl.dataset.phase = phase;

    if (phase === "reviewing") {
      if (this.reviewSectionEl) {
        this.reviewSectionEl.removeClass("is-hidden");
      }
    }
  }

  private updateStatusText(): void {
    if (!this.statusEl) return;
    const loadingDots = this.statusEl.querySelector(".llm-hub-workflow-generation-loading-dots");
    const statusKey = `workflow.generation.${this.currentPhase}` as const;
    this.statusEl.textContent = t(statusKey);
    if (loadingDots) {
      this.statusEl.appendChild(loadingDots);
    }
  }

  private setupDragHandle(dragHandle: HTMLElement, modalEl: HTMLElement): void {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = modalEl.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      modalEl.setCssStyles({
        position: "fixed",
        left: `${startLeft}px`,
        top: `${startTop}px`,
        transform: "none",
        margin: "0",
      });

      activeDocument.addEventListener("mousemove", onMouseMove);
      activeDocument.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      modalEl.setCssStyles({
        left: `${startLeft + dx}px`,
        top: `${startTop + dy}px`,
      });
    };

    const onMouseUp = () => {
      isDragging = false;
      activeDocument.removeEventListener("mousemove", onMouseMove);
      activeDocument.removeEventListener("mouseup", onMouseUp);
    };

    dragHandle.addEventListener("mousedown", onMouseDown);
  }

  appendThinking(content: string): void {
    if (this.thinkingSectionEl) {
      this.thinkingSectionEl.removeClass("is-hidden");
    }
    if (this.pendingThinkingSeparator && this.thinkingContainerEl) {
      this.thinkingContainerEl.createDiv({
        cls: "llm-hub-workflow-generation-thinking-separator",
        text: `── ${this.pendingThinkingSeparator} ──`,
      });
      this.pendingThinkingSeparator = null;
    }
    this.thinkingText += content;
    if (this.thinkingContainerEl) {
      this.thinkingContainerEl.createSpan({ text: content });
      this.thinkingContainerEl.scrollTop = this.thinkingContainerEl.scrollHeight;
    }
  }

  appendThinkingSeparator(phaseLabel: string): void {
    // Defer the separator — only render it once real thinking content arrives.
    // Overwriting with the newest phase label keeps us from accumulating
    // separators for phases that produced no thinking output.
    this.pendingThinkingSeparator = phaseLabel;
  }

  appendPlan(content: string): void {
    this.planText += content;
    if (this.planContainerEl) {
      this.planContainerEl.createSpan({ text: content });
      this.planContainerEl.scrollTop = this.planContainerEl.scrollHeight;
    }
  }

  appendReview(content: string): void {
    this.reviewText += content;
    if (this.reviewContainerEl) {
      this.reviewContainerEl.createSpan({ text: content });
      this.reviewContainerEl.scrollTop = this.reviewContainerEl.scrollHeight;
    }
  }

  getThinkingText(): string {
    return this.thinkingText;
  }

  getReviewText(): string {
    return this.reviewText;
  }

  beginRefining(label: string): void {
    if (this.statusEl) {
      this.statusEl.empty();
      this.statusEl.appendText(label);
      const loadingDotsEl = this.statusEl.createSpan({ cls: "llm-hub-workflow-generation-loading-dots" });
      loadingDotsEl.createSpan({ cls: "dot" });
      loadingDotsEl.createSpan({ cls: "dot" });
      loadingDotsEl.createSpan({ cls: "dot" });
      this.statusEl.addClass("llm-hub-workflow-generation-status-active");
    }
  }

  renderReviewAsMarkdown(markdown: string): void {
    if (!this.reviewContainerEl) return;

    if (!this.markdownComponent) {
      this.markdownComponent = new Component();
      this.markdownComponent.load();
    }

    this.reviewContainerEl.empty();
    this.reviewContainerEl.addClass("llm-hub-workflow-generation-plan-rendered");
    void MarkdownRenderer.render(
      this.app,
      markdown,
      this.reviewContainerEl,
      "/",
      this.markdownComponent
    );
  }

  private renderPlanAsMarkdown(): void {
    if (!this.planContainerEl || !this.planText) return;

    if (this.markdownComponent) {
      this.markdownComponent.unload();
    }
    this.markdownComponent = new Component();
    this.markdownComponent.load();

    this.planContainerEl.empty();
    this.planContainerEl.addClass("llm-hub-workflow-generation-plan-rendered");
    void MarkdownRenderer.render(
      this.app,
      this.planText,
      this.planContainerEl,
      "/",
      this.markdownComponent
    );
  }

  showPlanConfirmation(): Promise<PlanConfirmResult> {
    return new Promise((resolve) => {
      this.renderPlanAsMarkdown();

      const loadingDots = this.statusEl?.querySelector(".llm-hub-workflow-generation-loading-dots");
      if (loadingDots) loadingDots.remove();
      if (this.statusEl) {
        this.statusEl.textContent = t("workflow.generation.planComplete");
      }
      if (this.cancelBtn) {
        this.cancelBtn.addClass("is-hidden");
      }

      const { contentEl } = this;
      const confirmContainer = contentEl.createDiv({ cls: "llm-hub-workflow-generation-plan-confirm" });

      const feedbackContainer = confirmContainer.createDiv({ cls: "llm-hub-workflow-generation-plan-feedback is-hidden" });
      const feedbackEl = feedbackContainer.createEl("textarea", {
        cls: "llm-hub-workflow-generation-plan-feedback-input",
        attr: {
          placeholder: t("workflow.generation.replanPlaceholder"),
          rows: "3",
        },
      });

      const btnContainer = confirmContainer.createDiv({ cls: "llm-hub-workflow-generation-plan-confirm-buttons" });

      const cancelBtn = btnContainer.createEl("button", {
        text: t("common.cancel"),
      });

      const replanBtn = btnContainer.createEl("button", {
        text: t("workflow.generation.replan"),
        cls: "mod-warning",
      });

      const okBtn = btnContainer.createEl("button", {
        text: "OK",
        cls: "mod-cta",
      });

      const cleanup = () => {
        confirmContainer.remove();
      };

      cancelBtn.addEventListener("click", () => {
        cleanup();
        resolve({ action: "cancel" });
      });

      replanBtn.addEventListener("click", () => {
        if (feedbackContainer.hasClass("is-hidden")) {
          feedbackContainer.removeClass("is-hidden");
          replanBtn.textContent = t("workflow.preview.regenerate");
          feedbackEl.focus();
        } else {
          const feedback = feedbackEl.value.trim();
          if (!feedback) {
            feedbackEl.focus();
            return;
          }
          cleanup();
          resolve({ action: "replan", feedback });
        }
      });

      okBtn.addEventListener("click", () => {
        cleanup();
        resolve({ action: "ok" });
      });
    });
  }

  resetForReplan(): void {
    if (this.markdownComponent) {
      this.markdownComponent.unload();
      this.markdownComponent = null;
    }
    this.pendingThinkingSeparator = null;
    this.planText = "";
    if (this.planContainerEl) {
      this.planContainerEl.empty();
      this.planContainerEl.removeClass("llm-hub-workflow-generation-plan-rendered");
    }
    if (this.statusEl) {
      this.updateStatusText();
      const loadingDotsEl = this.statusEl.createSpan({ cls: "llm-hub-workflow-generation-loading-dots" });
      loadingDotsEl.createSpan({ cls: "dot" });
      loadingDotsEl.createSpan({ cls: "dot" });
      loadingDotsEl.createSpan({ cls: "dot" });
    }
    if (this.cancelBtn) {
      this.cancelBtn.removeClass("is-hidden");
    }
  }

  showReviewConfirmation(): Promise<ReviewConfirmResult> {
    return new Promise((resolve) => {
      const loadingDots = this.statusEl?.querySelector(".llm-hub-workflow-generation-loading-dots");
      if (loadingDots) loadingDots.remove();
      if (this.statusEl) {
        this.statusEl.textContent = t("workflow.generation.reviewComplete");
        this.statusEl.removeClass("llm-hub-workflow-generation-status-active");
      }
      if (this.cancelBtn) {
        this.cancelBtn.addClass("is-hidden");
      }

      const { contentEl } = this;
      const confirmContainer = contentEl.createDiv({
        cls: "llm-hub-workflow-generation-plan-confirm llm-hub-workflow-generation-review-confirm",
      });
      const btnContainer = confirmContainer.createDiv({ cls: "llm-hub-workflow-generation-plan-confirm-buttons" });

      const cancelBtn = btnContainer.createEl("button", { text: t("common.cancel") });
      const refineBtn = btnContainer.createEl("button", {
        text: t("workflow.generation.refineBtn"),
        cls: "mod-warning",
      });
      const okBtn = btnContainer.createEl("button", {
        text: "OK",
        cls: "mod-cta",
      });

      const cleanup = () => {
        confirmContainer.remove();
      };

      cancelBtn.addEventListener("click", () => { cleanup(); resolve({ action: "cancel" }); });
      refineBtn.addEventListener("click", () => { cleanup(); resolve({ action: "refine" }); });
      okBtn.addEventListener("click", () => { cleanup(); resolve({ action: "ok" }); });
    });
  }

  resetReviewForIteration(): void {
    this.pendingThinkingSeparator = null;
    this.reviewText = "";
    if (this.reviewContainerEl) {
      this.reviewContainerEl.empty();
      this.reviewContainerEl.removeClass("llm-hub-workflow-generation-plan-rendered");
    }
    this.contentEl.querySelectorAll(".llm-hub-workflow-generation-review-confirm").forEach(el => el.remove());
    if (this.statusEl) {
      this.statusEl.empty();
      this.statusEl.appendText(t("workflow.generation.reviewing"));
      const loadingDotsEl = this.statusEl.createSpan({ cls: "llm-hub-workflow-generation-loading-dots" });
      loadingDotsEl.createSpan({ cls: "dot" });
      loadingDotsEl.createSpan({ cls: "dot" });
      loadingDotsEl.createSpan({ cls: "dot" });
      this.statusEl.removeClass("llm-hub-workflow-generation-status-active");
    }
    if (this.cancelBtn) {
      this.cancelBtn.removeClass("is-hidden");
    }
  }

  setStatus(status: string): void {
    if (this.statusEl) {
      const loadingDots = this.statusEl.querySelector(".llm-hub-workflow-generation-loading-dots");
      this.statusEl.textContent = status;
      if (loadingDots) {
        this.statusEl.appendChild(loadingDots);
      }
    }
  }

  setComplete(): void {
    if (this.statusEl) {
      const loadingDots = this.statusEl.querySelector(".llm-hub-workflow-generation-loading-dots");
      if (loadingDots) {
        loadingDots.remove();
      }
    }
  }

  showParseFailure(response: string, errorMessage?: string): void {
    this.setComplete();
    this.setStatus(t("workflow.generation.parseFailed"));

    const failureEl = this.contentEl.createDiv({ cls: "llm-hub-workflow-generation-parse-failure" });
    failureEl.createEl("h3", { text: t("workflow.generation.parseFailed") });

    if (errorMessage) {
      failureEl.createEl("p", {
        text: errorMessage,
        cls: "llm-hub-workflow-generation-parse-failure-error",
      });
    }

    createCopyButton(failureEl, () => response);

    const pre = failureEl.createEl("pre", { cls: "llm-hub-workflow-generation-parse-failure-body" });
    pre.textContent = response;

    const closeBtn = failureEl.createEl("button", {
      text: t("common.close"),
      cls: "mod-cta",
    });
    closeBtn.addEventListener("click", () => this.close());
  }

  static formatUsageNotice(usage?: StreamChunkUsage, elapsedMs?: number): string | null {
    if (!usage && elapsedMs === undefined) return null;
    const parts: string[] = [];
    if (elapsedMs !== undefined) {
      parts.push(elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`);
    }
    if (usage?.inputTokens !== undefined && usage?.outputTokens !== undefined) {
      let tokens = `${usage.inputTokens.toLocaleString()} → ${usage.outputTokens.toLocaleString()} ${t("message.tokens")}`;
      if (usage.thinkingTokens) {
        tokens += ` (${t("message.thinkingTokens")} ${usage.thinkingTokens.toLocaleString()})`;
      }
      parts.push(tokens);
    }
    return parts.length > 0 ? parts.join(" | ") : null;
  }

  wasCancelled(): boolean {
    return this.isCancelled;
  }

  private cancel(): void {
    this.isCancelled = true;
    this.abortController.abort();
    this.onCancel();
    this.close();
  }

  onClose(): void {
    if (this.markdownComponent) {
      this.markdownComponent.unload();
      this.markdownComponent = null;
    }
    this.pendingThinkingSeparator = null;
    const { contentEl } = this;
    contentEl.empty();
  }
}
