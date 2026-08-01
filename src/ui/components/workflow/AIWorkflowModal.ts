import { App, Modal, Notice, parseYaml, TFile, MarkdownRenderer, Component } from "obsidian";
import type { LocalLlmHubPlugin } from "src/plugin";
import { localLlmChatStream } from "src/core/localLlmProvider";
import { SKILLS_FOLDER, WORKFLOWS_FOLDER, type LocalLlmConfig, type StreamChunkUsage, type Message } from "src/types";
import { WORKFLOW_SPECIFICATION } from "src/workflow/workflowSpec";
import type { SidebarNode, WorkflowNodeType, ExecutionStep } from "src/workflow/types";
import { findWorkflowBlocks, normalizeYamlText } from "src/workflow/parser";
import { ExecutionHistoryManager } from "src/workflow/history";
import { renderDiffView, createDiffViewToggle, formatLineComments, type DiffRendererState } from "./DiffRenderer";
import { WorkflowGenerationModal } from "./WorkflowGenerationModal";
import { showWorkflowPreview } from "./WorkflowPreviewModal";
import { showExecutionHistorySelect } from "./ExecutionHistorySelectModal";
import { ConfirmModal } from "../ConfirmModal";
import { formatError } from "src/utils/error";
import { createCopyButton } from "src/utils/copyButton";
import { findFileMentionOccurrences, findLiteralOccurrences, type MentionOccurrence } from "src/utils/mentionResolver";
import { t, getLocale } from "src/i18n";

export type AIWorkflowMode = "create" | "modify";

export interface ResolvedMention {
  original: string; // e.g., "@notes/file.md"
  content: string;  // The file content
}

export interface AIWorkflowResult {
  yaml: string;
  nodes: SidebarNode[];
  name: string;
  outputPath?: string; // Only for create mode
  explanation?: string; // AI's explanation of changes
  description?: string; // User's original request
  mode?: AIWorkflowMode; // "create" or "modify"
  resolvedMentions?: ResolvedMention[]; // File contents that were embedded
  createAsSkill?: boolean; // If true, create as agent skill
  rawMarkdown?: string; // Complete markdown from external LLM (saved as-is)
  skillInstructions?: string; // AI-generated SKILL.md instructions body
}

// Result type for confirmation modal
export type ConfirmResult = "ok" | "no" | "cancel";

export interface WorkflowConfirmResult {
  result: ConfirmResult;
  additionalRequest?: string;
}

/** Options to tweak the AI workflow modal behaviour. */
export interface AIWorkflowModalOptions {
  /** When true, treat this session as a skill even without a checkbox (used for skill-focused entry points). */
  isSkill?: boolean;
  /** Existing skill instructions (SKILL.md body), passed when modifying a skill. */
  existingInstructions?: string;
  /** Extra model-facing instructions appended to the user's request on every
   *  generation (e.g. an output-format contract for dashboard workflow widgets). */
  appendInstructions?: string;
}

/** Context from the generation phases, shown in preview/confirm modals */
export interface GenerationContext {
  plan?: string;
  thinking?: string;
  review?: string;
}

const LOCALE_DISPLAY_NAMES: Record<string, string> = {
  en: "English",
  ja: "Japanese (日本語)",
  es: "Spanish (Español)",
  fr: "French (Français)",
  zh: "Chinese (中文)",
  ko: "Korean (한국어)",
  pt: "Portuguese (Português)",
  it: "Italian (Italiano)",
  de: "German (Deutsch)",
};

function getLanguageName(): string {
  return LOCALE_DISPLAY_NAMES[getLocale()] || "English";
}

class WorkflowConfirmModal extends Modal {
  private oldYaml: string;
  private newYaml: string;
  private oldInstructions?: string;
  private newInstructions?: string;
  private explanation?: string;
  private currentRequest: string;
  private generationContext: GenerationContext;
  private isSkill: boolean;
  private resolvePromise: (result: WorkflowConfirmResult) => void;
  private additionalRequestEl: HTMLTextAreaElement | null = null;
  private markdownComponent: Component | null = null;
  private diffState: DiffRendererState | null = null;
  private instructionsDiffState: DiffRendererState | null = null;

  constructor(
    app: App,
    oldYaml: string,
    newYaml: string,
    explanation: string | undefined,
    currentRequest: string,
    generationContext: GenerationContext,
    isSkill: boolean,
    resolvePromise: (result: WorkflowConfirmResult) => void,
    oldInstructions?: string,
    newInstructions?: string
  ) {
    super(app);
    this.oldYaml = oldYaml;
    this.newYaml = newYaml;
    this.oldInstructions = oldInstructions;
    this.newInstructions = newInstructions;
    this.explanation = explanation;
    this.currentRequest = currentRequest;
    this.generationContext = generationContext;
    this.isSkill = isSkill;
    this.resolvePromise = resolvePromise;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-hub-workflow-confirm-modal");
    modalEl.addClass("llm-hub-modal-resizable");

    // Drag handle with title
    const dragHandle = contentEl.createDiv({ cls: "modal-drag-handle" });
    dragHandle.createEl("h2", {
      text: this.isSkill ? t("aiWorkflow.confirmSkillChanges") : t("aiWorkflow.confirmChanges"),
    });
    this.setupDragHandle(dragHandle, modalEl);

    // Scrollable middle area holds everything that can grow (explanation +
    // diff + generation context) so the textarea and buttons stay pinned.
    const scrollable = contentEl.createDiv({ cls: "llm-hub-workflow-confirm-scrollable" });

    if (this.currentRequest?.trim()) {
      const requestContainer = scrollable.createDiv({ cls: "llm-hub-workflow-user-request" });
      requestContainer.createEl("h3", { text: t("workflow.generation.yourRequest") });
      requestContainer.createEl("p", { text: this.currentRequest });
    }

    if (this.explanation) {
      const explanationContainer = scrollable.createDiv({ cls: "llm-hub-workflow-explanation" });
      const header = explanationContainer.createDiv({ cls: "llm-hub-workflow-generation-section-header" });
      header.createEl("h3", { text: t("aiWorkflow.aiExplanation") });
      const explanation = this.explanation;
      createCopyButton(header, () => explanation);
      explanationContainer.createEl("p", { text: this.explanation });
    }

    const showInstructions = this.isSkill
      && this.oldInstructions !== undefined
      && this.newInstructions !== undefined;
    const instructionsChanged = showInstructions && this.oldInstructions !== this.newInstructions;

    if (showInstructions) {
      const instrLabel = scrollable.createDiv({ cls: "llm-hub-edit-confirm-preview-label" });
      instrLabel.createSpan( { text: t("workflowModal.skillInstructionsChanges") });
      if (instructionsChanged) {
        const instrWrapper = scrollable.createDiv({ cls: "llm-hub-workflow-confirm-diff-wrapper" });
        this.instructionsDiffState = renderDiffView(
          instrWrapper,
          this.oldInstructions ?? "",
          this.newInstructions ?? "",
          { enableComments: false, viewMode: "unified" }
        );
        createDiffViewToggle(instrLabel, this.instructionsDiffState);
      } else {
        scrollable.createDiv({
          cls: "llm-hub-workflow-confirm-no-changes",
          text: t("workflowModal.noChanges"),
        });
      }
    }

    const yamlChanged = this.oldYaml !== this.newYaml;
    const diffLabel = scrollable.createDiv({ cls: "llm-hub-edit-confirm-preview-label" });
    diffLabel.createSpan( { text: t("workflowModal.changes") });
    if (yamlChanged) {
      const diffWrapper = scrollable.createDiv({ cls: "llm-hub-workflow-confirm-diff-wrapper llm-hub-workflow-confirm-diff" });
      this.diffState = renderDiffView(diffWrapper, this.oldYaml, this.newYaml, {
        enableComments: true,
      });
      createDiffViewToggle(diffLabel, this.diffState);
    } else {
      scrollable.createDiv({
        cls: "llm-hub-workflow-confirm-no-changes",
        text: t("workflowModal.noChanges"),
      });
    }

    this.markdownComponent = new Component();
    this.markdownComponent.load();
    // Diff is primary content in the confirm modal — keep plan/review collapsed.
    renderGenerationContext(scrollable, this.generationContext, this.app, this.markdownComponent, { defaultOpen: false });

    // Feedback textarea (always visible, pinned below scrollable)
    const additionalRequestContainer = contentEl.createDiv({
      cls: "llm-hub-workflow-preview-additional",
    });
    additionalRequestContainer.createEl("label", {
      text: t("workflow.preview.additionalRequest"),
    });
    this.additionalRequestEl = additionalRequestContainer.createEl("textarea", {
      cls: "llm-hub-workflow-preview-additional-input",
      attr: {
        placeholder: t("workflow.preview.additionalPlaceholder"),
        rows: "3",
      },
    });

    const buttonContainer = contentEl.createDiv({ cls: "llm-hub-workflow-buttons" });

    const cancelBtn = buttonContainer.createEl("button", { text: t("workflow.preview.cancel") });
    cancelBtn.addEventListener("click", () => {
      this.resolvePromise({ result: "cancel" });
      this.close();
    });

    const requestChangesBtn = buttonContainer.createEl("button", {
      text: t("message.requestChanges"),
      cls: "mod-warning",
    });
    const updateRequestChangesState = () => {
      const hasComments = this.diffState ? this.diffState.lineComments.size > 0 : false;
      const hasText = !!this.additionalRequestEl?.value?.trim();
      requestChangesBtn.disabled = !hasComments && !hasText;
    };
    if (this.diffState) {
      this.diffState.onCommentsChange = () => updateRequestChangesState();
    }
    this.additionalRequestEl.addEventListener("input", () => updateRequestChangesState());
    updateRequestChangesState();
    requestChangesBtn.addEventListener("click", () => {
      const generalFeedback = this.additionalRequestEl?.value?.trim() || "";
      const lineCommentsFeedback = this.diffState
        ? formatLineComments("workflow", this.diffState.lineComments)
        : "";
      const parts: string[] = [];
      if (lineCommentsFeedback) parts.push(lineCommentsFeedback);
      if (generalFeedback) parts.push(generalFeedback);
      this.resolvePromise({
        result: "no",
        additionalRequest: parts.join("\n"),
      });
      this.close();
    });

    const applyBtn = buttonContainer.createEl("button", {
      text: t("workflow.confirm.useThis"),
      cls: "mod-cta",
    });
    applyBtn.addEventListener("click", () => {
      this.resolvePromise({ result: "ok" });
      this.close();
    });
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

      // Set position to fixed for dragging
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

  onClose(): void {
    if (this.markdownComponent) {
      this.markdownComponent.unload();
      this.markdownComponent = null;
    }
    if (this.diffState) {
      this.diffState.destroy();
      this.diffState = null;
    }
    if (this.instructionsDiffState) {
      this.instructionsDiffState.destroy();
      this.instructionsDiffState = null;
    }
    const { contentEl } = this;
    contentEl.empty();
  }
}

// Helper function to show confirmation modal
function showWorkflowConfirmation(
  app: App,
  oldYaml: string,
  newYaml: string,
  explanation: string | undefined,
  currentRequest: string,
  generationContext: GenerationContext,
  isSkill: boolean,
  oldInstructions?: string,
  newInstructions?: string
): Promise<WorkflowConfirmResult> {
  return new Promise((resolve) => {
    const modal = new WorkflowConfirmModal(
      app, oldYaml, newYaml, explanation, currentRequest, generationContext, isSkill, resolve,
      oldInstructions, newInstructions
    );
    modal.open();
  });
}

// Mention item interface
interface MentionItem {
  value: string;
  description: string;
}

export class AIWorkflowModal extends Modal {
  private plugin: LocalLlmHubPlugin;
  private mode: AIWorkflowMode;
  private existingYaml?: string;
  private existingName?: string;
  /** When true, treat this session as a skill even without the checkbox (used for Modify/Create Skill with AI). */
  private forceSkill = false;
  /** Existing skill instructions (SKILL.md body), passed when modifying a skill. */
  private existingInstructions?: string;
  /** Extra model-facing instructions appended to the user's request (e.g. an
   *  output-format contract for dashboard workflow widgets). */
  private appendInstructions?: string;
  private resolvePromise: (result: AIWorkflowResult | null) => void;

  private nameInputEl: HTMLInputElement | null = null;
  private outputPathEl: HTMLInputElement | null = null;
  private descriptionEl: HTMLTextAreaElement | null = null;
  private confirmCheckbox: HTMLInputElement | null = null;
  private generateBtn: HTMLButtonElement | null = null;
  private copyPromptBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private isGenerating = false;

  // Paste response section (for external LLM flow)
  private pasteSectionEl: HTMLElement | null = null;
  private pasteTextareaEl: HTMLTextAreaElement | null = null;
  private cachedResolvedDescription: string | null = null;
  private cachedResolvedMentions: ResolvedMention[] | null = null;

  // Mention autocomplete state
  private mentionAutocompleteEl: HTMLElement | null = null;
  private mentionItems: MentionItem[] = [];
  private mentionIndex = 0;
  private mentionStartPos = 0;
  private showingMentionAutocomplete = false;
  private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

  private defaultOutputPath?: string;

  // Resize state
  private isDragging = false;
  private isResizing = false;
  private resizeDirection = "";
  private dragStartX = 0;
  private dragStartY = 0;
  private modalStartX = 0;
  private modalStartY = 0;
  private resizeStartWidth = 0;
  private resizeStartHeight = 0;

  // Execution history state (for modify mode)
  private selectedExecutionSteps: ExecutionStep[] = [];
  private executionHistoryInfoEl: HTMLElement | null = null;

  constructor(
    app: App,
    plugin: LocalLlmHubPlugin,
    mode: AIWorkflowMode,
    resolvePromise: (result: AIWorkflowResult | null) => void,
    existingYaml?: string,
    existingName?: string,
    defaultOutputPath?: string,
    options?: AIWorkflowModalOptions
  ) {
    super(app);
    this.plugin = plugin;
    this.mode = mode;
    this.existingYaml = existingYaml;
    this.existingName = existingName;
    this.resolvePromise = resolvePromise;
    this.defaultOutputPath = defaultOutputPath;
    this.forceSkill = options?.isSkill ?? false;
    this.existingInstructions = options?.existingInstructions;
    this.appendInstructions = options?.appendInstructions;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-hub-workflow-modal");
    modalEl.addClass("llm-hub-resizable-modal");

    // Drag handle with title
    const dragHandle = contentEl.createDiv({ cls: "modal-drag-handle" });
    const title =
      this.mode === "create"
        ? this.forceSkill
          ? t("aiWorkflow.createSkillTitle")
          : t("aiWorkflow.createTitle")
        : this.forceSkill
          ? t("aiWorkflow.modifySkillTitle")
          : t("aiWorkflow.modifyTitle");
    dragHandle.createEl("h2", { text: title });
    this.setupDrag(dragHandle, modalEl);

    // Add resize handles
    this.addResizeHandles(modalEl);

    if (this.mode === "create") {
      const nameContainer = contentEl.createDiv({ cls: "llm-hub-workflow-input-row" });
      nameContainer.createEl("label", {
        text: this.forceSkill ? t("aiWorkflow.skillName") : t("aiWorkflow.workflowName"),
      });
      this.nameInputEl = nameContainer.createEl("input", {
        type: "text",
        cls: "llm-hub-workflow-name-input",
        attr: {
          placeholder: this.forceSkill
            ? t("aiWorkflow.skillNamePlaceholder")
            : t("aiWorkflow.namePlaceholder"),
        },
      });

      // Skill output path is locked to SKILLS_FOLDER — skills are addressed by folder name
      // so the generator shouldn't be able to drop them elsewhere.
      const pathContainer = contentEl.createDiv({ cls: "llm-hub-workflow-input-row" });
      pathContainer.createEl("label", { text: t("aiWorkflow.outputPath") });
      const defaultPath = this.forceSkill
        ? `${SKILLS_FOLDER}/{{name}}`
        : this.defaultOutputPath || `${WORKFLOWS_FOLDER}/{{name}}`;
      this.outputPathEl = pathContainer.createEl("input", {
        type: "text",
        cls: "llm-hub-workflow-path-input",
        value: defaultPath,
        attr: { placeholder: `${WORKFLOWS_FOLDER}/{{name}}` },
      });
      if (this.forceSkill) {
        this.outputPathEl.disabled = true;
      }
      pathContainer.createDiv( {
        cls: "llm-hub-workflow-hint",
        text: t("aiWorkflow.pathHint"),
      });

    }

    const descLabel =
      this.mode === "create"
        ? this.forceSkill
          ? t("aiWorkflow.describeCreateSkill")
          : t("aiWorkflow.describeCreate")
        : t("aiWorkflow.describeModify");

    contentEl.createEl("label", {
      text: descLabel,
      cls: "llm-hub-workflow-label",
    });

    // Description textarea container (for autocomplete positioning)
    const textareaContainer = contentEl.createDiv({ cls: "llm-hub-workflow-textarea-container" });

    // Mention autocomplete dropdown
    this.mentionAutocompleteEl = textareaContainer.createDiv({
      cls: "llm-hub-autocomplete llm-hub-workflow-mention-autocomplete is-hidden",
    });

    // Description textarea
    this.descriptionEl = textareaContainer.createEl("textarea", {
      cls: "llm-hub-workflow-textarea",
      attr: {
        placeholder:
          this.mode === "create"
            ? this.forceSkill
              ? t("aiWorkflow.placeholderCreateSkill")
              : t("aiWorkflow.placeholderCreate")
            : t("aiWorkflow.placeholderModify"),
        rows: "6",
      },
    });

    // Invalidate cached mentions when description changes
    this.descriptionEl.addEventListener("input", () => {
      this.cachedResolvedDescription = null;
      this.cachedResolvedMentions = null;
    });

    // Setup mention autocomplete handlers
    this.setupMentionAutocomplete();

    // Hint for @ mention
    contentEl.createDiv( {
      cls: "llm-hub-workflow-hint",
      text: t("aiWorkflow.mentionHint"),
    });

    // Show current workflow for modify mode
    if (this.mode === "modify" && this.existingYaml) {
      const details = contentEl.createEl("details", {
        cls: "llm-hub-workflow-existing",
      });
      details.createEl("summary", { text: t("aiWorkflow.currentWorkflow") });
      details.createEl("pre", {
        text: this.existingYaml,
        cls: "llm-hub-workflow-yaml-preview",
      });
    }

    // Confirmation checkbox (only for modify mode)
    if (this.mode === "modify") {
      const confirmContainer = contentEl.createDiv({ cls: "llm-hub-workflow-confirm-row" });
      this.confirmCheckbox = confirmContainer.createEl("input", {
        type: "checkbox",
        attr: { id: "llm-hub-workflow-confirm-checkbox" },
      });
      this.confirmCheckbox.checked = true; // Default to checked
      confirmContainer.createEl("label", {
        text: t("aiWorkflow.confirmCheckbox"),
        attr: { for: "llm-hub-workflow-confirm-checkbox" },
      });

      // Execution history reference row (only for modify mode)
      const executionHistoryRow = contentEl.createDiv({ cls: "llm-hub-workflow-execution-history-row" });

      const executionHistoryBtn = executionHistoryRow.createEl("button", {
        cls: "llm-hub-workflow-execution-history-btn",
      });
      executionHistoryBtn.createSpan({ text: t("workflow.preview.referenceHistory") });

      this.executionHistoryInfoEl = executionHistoryRow.createDiv({
        cls: "llm-hub-workflow-execution-history-info"
      });

      executionHistoryBtn.addEventListener("click", () => {
        void this.openExecutionHistorySelect();
      });
    }

    // Status area
    this.statusEl = contentEl.createDiv({ cls: "llm-hub-workflow-status" });

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: "llm-hub-workflow-buttons" });

    const cancelBtn = buttonContainer.createEl("button", { text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => {
      this.resolvePromise(null);
      this.close();
    });

    this.copyPromptBtn = buttonContainer.createEl("button", {
      text: t("aiWorkflow.copyPrompt"),
    });
    this.copyPromptBtn.addEventListener("click", () => {
      void this.exportPrompt();
    });

    this.generateBtn = buttonContainer.createEl("button", {
      text: this.mode === "create" ? t("aiWorkflow.generate") : t("aiWorkflow.modify"),
      cls: "mod-cta",
    });
    this.generateBtn.addEventListener("click", () => {
      void this.generate();
    });

    // Paste response section (hidden until Copy Prompt is clicked)
    this.pasteSectionEl = contentEl.createDiv({ cls: "llm-hub-workflow-paste-section is-hidden" });

    this.pasteSectionEl.createEl("label", {
      text: t("aiWorkflow.pasteLabel"),
      cls: "llm-hub-workflow-label",
    });

    this.pasteTextareaEl = this.pasteSectionEl.createEl("textarea", {
      cls: "llm-hub-workflow-textarea",
      attr: {
        placeholder: t("aiWorkflow.pastePlaceholder"),
        rows: "10",
      },
    });

    const pasteButtonContainer = this.pasteSectionEl.createDiv({ cls: "llm-hub-workflow-buttons" });
    const applyBtn = pasteButtonContainer.createEl("button", {
      text: t("aiWorkflow.applyPasted"),
      cls: "mod-cta",
    });
    applyBtn.addEventListener("click", () => {
      void this.applyPastedResponse();
    });

    // Focus appropriate field
    if (this.mode === "create") {
      window.setTimeout(() => this.nameInputEl?.focus(), 50);
    } else {
      window.setTimeout(() => this.descriptionEl?.focus(), 50);
    }
  }

  /**
   * Open execution history select modal (for modify mode)
   */
  private async openExecutionHistorySelect(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice(t("workflowModal.noExecutionHistory"));
      return;
    }

    try {
      const encryption = this.plugin.settings.encryption;
      const encryptionConfig = encryption?.enabled ? {
        enabled: true,
        encryptWorkflowHistory: encryption.encryptWorkflowHistory,
        publicKey: encryption.publicKey || "",
        encryptedPrivateKey: encryption.encryptedPrivateKey || "",
        salt: encryption.salt || "",
      } : undefined;
      const historyManager = new ExecutionHistoryManager(
        this.app,
        encryptionConfig
      );
      const executionRecords = await historyManager.loadRecords(activeFile.path);

      if (executionRecords.length === 0) {
        new Notice(t("workflowModal.noExecutionHistory"));
        return;
      }

      const result = await showExecutionHistorySelect(this.app, executionRecords);
      if (result && result.selectedSteps.length > 0) {
        this.selectedExecutionSteps = result.selectedSteps;
        this.updateExecutionHistoryInfo();
      }
    } catch (e) {
      console.error("Failed to load execution history:", formatError(e));
      new Notice(t("workflowModal.noExecutionHistory"));
    }
  }

  /**
   * Update execution history info display
   */
  private updateExecutionHistoryInfo(): void {
    if (!this.executionHistoryInfoEl) return;

    if (this.selectedExecutionSteps.length > 0) {
      this.executionHistoryInfoEl.textContent = t("workflow.preview.stepsSelected", {
        count: String(this.selectedExecutionSteps.length),
      });
      this.executionHistoryInfoEl.removeClass("is-hidden");
    } else {
      this.executionHistoryInfoEl.textContent = "";
      this.executionHistoryInfoEl.addClass("is-hidden");
    }
  }

  /**
   * Copy the full prompt (system + user) to clipboard for use with external LLMs.
   * Create mode: asks for markdown with ```llm-workflow code blocks.
   * Modify mode: asks for YAML output (to apply to existing file).
   */
  private async exportPrompt(): Promise<void> {
    // Validate name for create mode
    if (this.mode === "create") {
      const name = this.nameInputEl?.value?.trim();
      if (!name) {
        new Notice(t("aiWorkflow.enterName"));
        return;
      }
    }

    const description = this.descriptionEl?.value?.trim();
    if (!description) {
      new Notice(t("aiWorkflow.enterDescription"));
      return;
    }

    const workflowName = this.mode === "create"
      ? this.nameInputEl?.value?.trim() || "workflow"
      : this.existingName || "workflow";

    // Resolve @ mentions
    const { resolved, mentions } = await this.resolveMentions(description);
    this.cachedResolvedDescription = resolved;
    this.cachedResolvedMentions = mentions;

    const isSkill = this.forceSkill;
    const systemPrompt = this.buildSystemPrompt(true, isSkill);
    const userPrompt = this.buildUserPrompt(
      resolved,
      workflowName,
      undefined,
      [],
      this.selectedExecutionSteps.length > 0 ? this.selectedExecutionSteps : undefined,
      isSkill
    );

    const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

    // Copy to clipboard
    await navigator.clipboard.writeText(fullPrompt);

    // Show paste response section, scroll it into view, and focus the textarea
    this.pasteSectionEl?.removeClass("is-hidden");
    this.pasteSectionEl?.scrollIntoView({ behavior: "smooth", block: "end" });
    window.setTimeout(() => this.pasteTextareaEl?.focus(), 100);

    new Notice(t("aiWorkflow.promptCopied"));
  }

  /**
   * For non-skill workflow creation, refuse to continue when the target markdown
   * file already contains a workflow block. This runs before expensive AI
   * generation and again before accepting pasted/generated output.
   */
  private async rejectIfTargetHasWorkflow(outputPath: string): Promise<boolean> {
    if (this.forceSkill) return false;

    const path = outputPath.endsWith(".md") ? outputPath : `${outputPath}.md`;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (!(existing instanceof TFile)) return false;

    const existingContent = await this.app.vault.cachedRead(existing);
    if (findWorkflowBlocks(existingContent).length === 0) return false;

    new Notice(t("workflow.generation.outputPathTaken", { path }));
    return true;
  }

  /**
   * Apply a pasted response from an external LLM.
   * Create mode: saves raw markdown with workflow code blocks.
   * Modify mode: parses YAML and returns nodes.
   */
  private async applyPastedResponse(): Promise<void> {
    const pastedText = this.pasteTextareaEl?.value?.trim();
    if (!pastedText) {
      new Notice(t("aiWorkflow.enterPastedYaml"));
      return;
    }

    const workflowName = this.mode === "create"
      ? this.nameInputEl?.value?.trim() || "workflow"
      : this.existingName || "workflow";

    // Re-resolve mentions if cache was invalidated (description changed after Copy Prompt)
    if (this.cachedResolvedDescription === null) {
      const rawDesc = this.descriptionEl?.value?.trim() || "";
      const { resolved, mentions } = await this.resolveMentions(rawDesc);
      this.cachedResolvedDescription = resolved;
      this.cachedResolvedMentions = mentions;
    }

    const description = this.cachedResolvedDescription || this.descriptionEl?.value?.trim() || "";
    const resolvedMentions = this.cachedResolvedMentions?.length
      ? this.cachedResolvedMentions
      : undefined;

    if (this.mode === "create") {
      const isSkill = this.forceSkill;

      // Create mode: save markdown directly (validate it has workflow blocks)
      const options = findWorkflowBlocks(pastedText);
      if (options.length === 0) {
        // Fallback: try parsing as raw YAML
        const parsed = parseWorkflowResponse(pastedText);
        if (!parsed) {
          new Notice(t("workflow.generation.parseFailed"));
          return;
        }
        // Return as normal result (will be built into markdown by save logic)
        parsed.name = workflowName;
        parsed.description = description;
        parsed.mode = "create";
        parsed.resolvedMentions = resolvedMentions;
        const outputPathTemplate = this.outputPathEl?.value?.trim() || `${WORKFLOWS_FOLDER}/{{name}}`;
        parsed.outputPath = outputPathTemplate.replace(/\{\{name\}\}/g, workflowName);
        if (isSkill) {
          parsed.createAsSkill = true;
          // Extract skill instructions from explanation (text before YAML, strip trailing ---)
          if (parsed.explanation) {
            parsed.skillInstructions = parsed.explanation.replace(/\n---\s*$/, "").trim();
          }
        }
        if (await this.rejectIfTargetHasWorkflow(parsed.outputPath)) return;
        this.resolvePromise(parsed);
        this.close();
        return;
      }

      // Extract skill instructions from text before first ```llm-workflow block
      let skillInstructions: string | undefined;
      let workflowMarkdown = pastedText;
      if (isSkill) {
        const workflowBlockMatch = pastedText.match(/^`{3,}llm-workflow/m);
        if (workflowBlockMatch && workflowBlockMatch.index !== undefined && workflowBlockMatch.index > 0) {
          const textBefore = pastedText.substring(0, workflowBlockMatch.index).trim();
          if (textBefore) {
            skillInstructions = textBefore;
          }
          workflowMarkdown = pastedText.substring(workflowBlockMatch.index);
        }
      }

      // Save as raw markdown
      const outputPathTemplate = this.outputPathEl?.value?.trim() || `${WORKFLOWS_FOLDER}/{{name}}`;
      const result: AIWorkflowResult = {
        yaml: "",
        nodes: [],
        name: workflowName,
        outputPath: outputPathTemplate.replace(/\{\{name\}\}/g, workflowName),
        description,
        mode: "create",
        resolvedMentions,
        createAsSkill: isSkill,
        rawMarkdown: workflowMarkdown,
        skillInstructions,
      };
      if (await this.rejectIfTargetHasWorkflow(result.outputPath!)) return;
      this.resolvePromise(result);
      this.close();
    } else {
      // Modify mode: parse YAML and return nodes
      const result = parseWorkflowResponse(pastedText);
      if (!result) {
        new Notice(t("workflow.generation.parseFailed"));
        return;
      }

      result.name = workflowName;
      result.description = description;
      result.mode = this.mode;
      result.resolvedMentions = resolvedMentions;

      this.resolvePromise(result);
      this.close();
    }
  }

  private async generate(): Promise<void> {
    if (this.isGenerating) return;

    // Validate name for create mode
    if (this.mode === "create") {
      const name = this.nameInputEl?.value?.trim();
      if (!name) {
        new Notice(t("aiWorkflow.enterName"));
        return;
      }
    }

    const description = this.descriptionEl?.value?.trim();
    if (!description) {
      new Notice(t("aiWorkflow.enterDescription"));
      return;
    }

    // Get name for create mode
    const workflowName = this.mode === "create"
      ? this.nameInputEl?.value?.trim() || "workflow"
      : this.existingName || "workflow";

    // Get output path template for create mode
    const outputPathTemplate = this.mode === "create"
      ? this.outputPathEl?.value?.trim() || `${WORKFLOWS_FOLDER}/{{name}}/main`
      : undefined;

    if (this.mode === "create" && outputPathTemplate) {
      const outputPath = outputPathTemplate.replace(/\{\{name\}\}/g, workflowName);
      if (await this.rejectIfTargetHasWorkflow(outputPath)) return;
    }

    // Resolve @ mentions (embed file content, selection, etc.)
    const { resolved: resolvedDescription, mentions: resolvedMentions } = await this.resolveMentions(description);

    // Get model display name from config
    const modelDisplayName = this.plugin.settings.llmConfig.model || "Local LLM";

    // Close input modal and start generation flow
    this.close();

    // Determine the workflow path for loading execution history
    // For modify mode, use the active file path; for create mode, we'll construct it later
    const activeFile = this.app.workspace.getActiveFile();
    const workflowPath = this.mode === "modify" && activeFile ? activeFile.path : undefined;

    // Start the generation with preview loop
    // Use resolved description (with @mentions expanded) as the request
    // Pass selected execution steps if any (for modify mode)
    await this.runGenerationLoop(
      resolvedDescription,
      workflowName,
      outputPathTemplate,
      resolvedMentions,
      workflowPath,
      modelDisplayName,
      undefined,  // previousYaml
      [],         // requestHistory
      this.selectedExecutionSteps.length > 0 ? this.selectedExecutionSteps : undefined
    );
  }

  /**
   * Run the generation loop with progress display and preview confirmation.
   * Runs three phases:
   *   1. Planning - produces a plain-language plan before generation (first creation only)
   *   2. Generation - creates the workflow YAML using the plan as context
   *   3. Review - critiques the output; user can accept, refine, or cancel
   */
  private async runGenerationLoop(
    currentRequest: string,
    workflowName: string,
    outputPathTemplate: string | undefined,
    resolvedMentions: ResolvedMention[],
    workflowPath: string | undefined,
    modelDisplayName: string,
    previousYaml?: string,
    requestHistory: string[] = [],
    selectedExecutionSteps?: ExecutionStep[]
  ): Promise<void> {

    // Create AbortController for cancellation
    const abortController = new AbortController();
    let generationCancelled = false;

    // Planning runs on first creation only (not on user-requested revisions
    // or modifications to existing workflows); review always runs.
    const shouldPlan = requestHistory.length === 0 && !this.existingYaml;

    // Open the generation modal
    const generationModal = new WorkflowGenerationModal(
      this.app,
      currentRequest,
      abortController,
      () => { generationCancelled = true; },
      selectedExecutionSteps?.length ?? 0,
      modelDisplayName,
      shouldPlan
    );
    generationModal.open();

    try {
      const isSkill = this.forceSkill;
      const config: LocalLlmConfig = {
        ...this.plugin.settings.llmConfig,
      };

      const isCancelled = () => generationCancelled || abortController.signal.aborted;

      let totalUsage: StreamChunkUsage | undefined;
      const apiStartTime = Date.now();

      let plan: string | undefined;
      if (shouldPlan) {
        let planRequest = currentRequest;
        while (true) {
          generationModal.setPhase("planning");
          const planResult = await this.runPlanningPhase(
            config, planRequest, workflowName, isSkill,
            generationModal, abortController.signal, isCancelled
          );
          plan = planResult.plan;
          totalUsage = mergeUsage(totalUsage, planResult.usage);
          if (isCancelled()) {
            generationModal.close();
            this.resolvePromise(null);
            return;
          }

          const confirm = await generationModal.showPlanConfirmation();
          if (confirm.action === "cancel") {
            generationModal.close();
            this.resolvePromise(null);
            return;
          }
          if (confirm.action === "ok") {
            break;
          }
          planRequest = `${currentRequest}\n\nFeedback on previous plan:\n${confirm.feedback}`;
          generationModal.resetForReplan();
        }
      }

      generationModal.appendThinkingSeparator(t("workflow.generation.phaseGenerate"));
      generationModal.setPhase("generating");

      const systemPrompt = this.buildSystemPrompt(false, isSkill);
      const userPrompt = this.buildUserPrompt(
        currentRequest, workflowName, previousYaml, requestHistory,
        selectedExecutionSteps, isSkill, plan
      );

      let response = "";
      const genMessages: Message[] = [{
        role: "user",
        content: userPrompt,
        timestamp: Date.now(),
      }];

      for await (const chunk of localLlmChatStream(
        config, genMessages, systemPrompt, abortController.signal
      )) {
        if (isCancelled()) break;
        if (chunk.type === "thinking" && chunk.content) {
          generationModal.appendThinking(chunk.content);
        } else if (chunk.type === "text" && chunk.content) {
          response += chunk.content;
        } else if (chunk.type === "done") {
          totalUsage = mergeUsage(totalUsage, chunk.usage);
        } else if (chunk.type === "error") {
          throw new Error(chunk.error || "Unknown error");
        }
      }

      if (isCancelled()) {
        generationModal.close();
        this.resolvePromise(null);
        return;
      }

      let parsed = parseWorkflowResponseWithError(response);
      let result = parsed.result;

      // Auto-repair: if parsing failed, re-prompt the LLM with the broken output
      // and the specific error so it can fix its own YAML. Max 2 attempts.
      const maxRepairAttempts = 2;
      for (let attempt = 1; !result && attempt <= maxRepairAttempts; attempt++) {
        if (isCancelled()) break;
        const parseError = parsed.error ?? "unknown parse error";
        console.warn(`[local-llm-hub] Parse failed (attempt ${attempt}/${maxRepairAttempts}): ${parseError}`);
        generationModal.appendThinkingSeparator(`${t("workflow.generation.phaseGenerate")} (auto-repair ${attempt}/${maxRepairAttempts})`);
        generationModal.setStatus(t("workflow.generation.reviewRefining"));

        const repairPrompt = `Your previous output could not be parsed into a valid workflow.

PARSE ERROR:
${parseError}

YOUR PREVIOUS OUTPUT:
${response}

Fix the problem and output ONLY the complete, valid YAML workflow starting with "name:". Do not include any prose, explanation, or commentary — just the YAML.`;

        let repaired = "";
        for await (const chunk of localLlmChatStream(
          config,
          [{ role: "user", content: repairPrompt, timestamp: Date.now() }],
          systemPrompt,
          abortController.signal
        )) {
          if (isCancelled()) break;
          if (chunk.type === "thinking" && chunk.content) {
            generationModal.appendThinking(chunk.content);
          } else if (chunk.type === "text" && chunk.content) {
            repaired += chunk.content;
          } else if (chunk.type === "done") {
            totalUsage = mergeUsage(totalUsage, chunk.usage);
          } else if (chunk.type === "error") {
            throw new Error(chunk.error || "Unknown error");
          }
        }

        if (isCancelled()) {
          generationModal.close();
          this.resolvePromise(null);
          return;
        }
        response = repaired;
        parsed = parseWorkflowResponseWithError(response);
        result = parsed.result;
      }

      if (!result) {
        console.error("[local-llm-hub] Generation failed after auto-repair. Last error:", parsed.error, "Response:", response);
        generationModal.showParseFailure(response, parsed.error);
        new Notice(t("workflow.generation.parseFailed"));
        this.resolvePromise(null);
        return;
      }

      let critiqueResult: ReviewResult | undefined;
      let reviewIteration = 0;
      while (true) {
        if (reviewIteration === 0) {
          generationModal.appendThinkingSeparator(t("workflow.generation.phaseReview"));
          generationModal.setPhase("reviewing");
        } else {
          generationModal.resetReviewForIteration();
          generationModal.appendThinkingSeparator(t("workflow.generation.phaseReview"));
        }
        reviewIteration++;

        const reviewResult = await this.runReviewPhase(
          config, currentRequest, plan || "", result.yaml, isSkill,
          this.appendInstructions, generationModal, abortController.signal, isCancelled
        );
        critiqueResult = reviewResult.review;
        totalUsage = mergeUsage(totalUsage, reviewResult.usage);

        if (critiqueResult) {
          generationModal.renderReviewAsMarkdown(formatReviewAsMarkdown(critiqueResult));
        }

        if (isCancelled()) {
          generationModal.close();
          this.resolvePromise(null);
          return;
        }

        // No issues at all — skip the confirmation UI and proceed automatically.
        if (critiqueResult && critiqueResult.issues.length === 0) {
          generationModal.setStatus(t("workflow.generation.reviewApproved"));
          break;
        }

        // Issues present (or review couldn't be parsed) — let the user decide:
        // accept / refine / cancel. Inner loop so that if the user tries to
        // accept but then cancels the "are you sure?" confirm dialog, we re-show
        // the review confirmation without re-running the (expensive) review phase.
        let reviewAction: "ok" | "refine" | "cancel" | null = null;
        while (reviewAction === null) {
          const reviewConfirm = await generationModal.showReviewConfirmation();
          if (reviewConfirm.action === "cancel" || reviewConfirm.action === "refine") {
            reviewAction = reviewConfirm.action;
            break;
          }
          // Explicit confirm when issues were flagged — avoid accidental accept.
          const confirmed = await new ConfirmModal(
            this.app,
            t("workflow.generation.acceptWithIssuesConfirm"),
          ).openAndWait();
          if (confirmed) reviewAction = "ok";
        }
        if (reviewAction === "cancel") {
          generationModal.close();
          this.resolvePromise(null);
          return;
        }
        if (reviewAction === "ok") break;

        // Refine: run another generation pass using the review issues as
        // feedback, then loop back to re-review the refined result.
        if (!critiqueResult) {
          // No critique to drive refinement — avoid an infinite loop.
          break;
        }
        generationModal.beginRefining(t("workflow.generation.reviewRefining"));
        generationModal.appendThinkingSeparator(t("workflow.generation.reviewRefining"));
        const refinement = await this.runRefinementPass(
          config, currentRequest, plan || "", result.yaml, result.explanation,
          critiqueResult, systemPrompt, isSkill, this.appendInstructions, generationModal, abortController.signal, isCancelled
        );
        totalUsage = mergeUsage(totalUsage, refinement.usage);

        if (isCancelled()) {
          generationModal.close();
          this.resolvePromise(null);
          return;
        }

        if (refinement.response) {
          const refinedResult = this.parseResponse(refinement.response);
          if (refinedResult) result = refinedResult;
        }
      }


      const reviewDisplay = critiqueResult
        ? formatReviewAsMarkdown(critiqueResult)
        : generationModal.getReviewText() || undefined;

      const generationContext: GenerationContext = {
        plan: plan || undefined,
        thinking: generationModal.getThinkingText() || undefined,
        review: reviewDisplay || undefined,
      };

      const apiElapsedMs = Date.now() - apiStartTime;
      generationModal.setComplete();
      generationModal.close();

      // Show usage as Notice
      const apiNotice = WorkflowGenerationModal.formatUsageNotice(totalUsage, apiElapsedMs);
      if (apiNotice) {
        new Notice(apiNotice);
      }

      // Add metadata to result - only store current request as description
      result.description = currentRequest;
      result.mode = this.mode;
      result.resolvedMentions = resolvedMentions.length > 0 ? resolvedMentions : undefined;
      if (this.forceSkill) {
        result.createAsSkill = true;
        // Extract skill instructions from explanation (text before YAML, strip trailing ---)
        if (result.explanation) {
          result.skillInstructions = result.explanation.replace(/\n---\s*$/, "").trim();
        }
      }

      // Override name with user input for create mode
      if (this.mode === "create") {
        result.name = workflowName;
        if (outputPathTemplate) {
          result.outputPath = outputPathTemplate.replace(/\{\{name\}\}/g, workflowName);
        }
      }

      // For modify mode with confirmation enabled, use the diff view
      const needsDiffConfirmation =
        this.mode === "modify" &&
        this.confirmCheckbox?.checked &&
        this.existingYaml;

      if (needsDiffConfirmation) {
        const confirmResult = await showWorkflowConfirmation(
          this.app,
          this.existingYaml!,
          result.yaml,
          result.explanation,
          currentRequest,
          generationContext,
          this.forceSkill,
          this.forceSkill ? this.existingInstructions : undefined,
          this.forceSkill ? result.skillInstructions : undefined,
        );

        if (confirmResult.result === "ok") {
          this.resolvePromise(result);
        } else if (confirmResult.result === "no") {
          // User wants modifications
          const updatedHistory = [...requestHistory, currentRequest];
          await this.runGenerationLoop(
            confirmResult.additionalRequest || "",  // New request from user
            workflowName,
            outputPathTemplate,
            resolvedMentions,
            workflowPath,     // Workflow path for execution history
            modelDisplayName,
            result.yaml,      // Previous YAML for reference
            updatedHistory,   // Accumulated request history
            selectedExecutionSteps  // Keep original execution steps for context
          );
        } else {
          // User cancelled
          this.resolvePromise(null);
        }
        return;
      }

      // Show preview modal for create mode and modify mode without diff confirmation
      // Pass the current request so user can edit it for the next iteration
      const previewResult = await showWorkflowPreview(
        this.app,
        result.yaml,
        result.nodes,
        result.name,
        currentRequest,
        generationContext
      );

      if (previewResult.result === "ok") {
        // User approved - return the result
        this.resolvePromise(result);
      } else if (previewResult.result === "no") {
        // User wants modifications
        const updatedHistory = [...requestHistory, currentRequest];
        await this.runGenerationLoop(
          previewResult.additionalRequest || "",  // New request from user
          workflowName,
          outputPathTemplate,
          resolvedMentions,
          workflowPath,     // Workflow path for execution history
          modelDisplayName,
          result.yaml,      // Previous YAML for reference
          updatedHistory,   // Accumulated request history
          selectedExecutionSteps  // Keep original execution steps for context
        );
      } else {
        // User cancelled
        this.resolvePromise(null);
      }
    } catch (error) {
      generationModal.close();
      const message = formatError(error);
      new Notice(`Error: ${message}`);
      this.resolvePromise(null);
    }
  }

  /**
   * Phase 1: Planning - produce a plain-language plan before generation.
   * Returns the plan text, or undefined if planning fails (non-fatal).
   */
  private async runPlanningPhase(
    config: LocalLlmConfig,
    currentRequest: string,
    workflowName: string,
    isSkill: boolean,
    generationModal: WorkflowGenerationModal,
    signal: AbortSignal,
    isCancelled: () => boolean
  ): Promise<{ plan?: string; usage?: StreamChunkUsage }> {
    const languageName = getLanguageName();

    const skillGuidance = isSkill
      ? `

For skills (reusable tools the AI assistant can trigger), also cover:
- When this skill should activate (what the user might say or ask)
- What input the user provides
- What the skill produces as output`
      : "";

    const planSystemPrompt = `You help users plan what their Obsidian automation should do. Write the plan so anyone can understand it — NOT just engineers.

Describe the plan in plain language covering:
1. **What it does** — The goal in one or two sentences
2. **Steps** — What happens, in order, as numbered bullet points (e.g., "Ask the user for a topic", "Search the vault for related notes", "Show the results")
3. **Inputs** — What information is needed from the user or environment
4. **Outputs** — What the user gets when it finishes
5. **Things to watch out for** — Potential issues in plain language (e.g., "What if no notes are found?")
${skillGuidance}

IMPORTANT RULES:
- Write the ENTIRE plan in ${languageName}.
- Avoid technical jargon. Do NOT mention node types, YAML, variable names, or implementation details.
- Use simple sentences a non-engineer could follow.
- Keep it concise — roughly 10–20 short bullet points total.
- Do NOT generate any code or YAML.`;

    const entityType = isSkill ? "skill" : "workflow";
    const existingContext = this.existingYaml
      ? `\n\nEXISTING WORKFLOW TO MODIFY:\n${this.existingYaml}`
      : "";
    const planUserPrompt = `Plan a ${entityType} named "${workflowName}" that does the following:

${currentRequest}${existingContext}`;

    try {
      let plan = "";
      let usage: StreamChunkUsage | undefined;
      const messages: Message[] = [{
        role: "user",
        content: planUserPrompt,
        timestamp: Date.now(),
      }];
      for await (const chunk of localLlmChatStream(
        config, messages, planSystemPrompt, signal
      )) {
        if (isCancelled()) return {};

        if (chunk.type === "thinking" && chunk.content) {
          generationModal.appendThinking(chunk.content);
        } else if (chunk.type === "text" && chunk.content) {
          plan += chunk.content;
          generationModal.appendPlan(chunk.content);
        } else if (chunk.type === "done") {
          usage = chunk.usage;
        } else if (chunk.type === "error") {
          console.warn("Planning phase error:", chunk.error);
          return {}; // Non-fatal: proceed without plan
        }
      }
      return { plan: plan || undefined, usage };
    } catch (error) {
      console.warn("Planning phase failed, proceeding without plan:", formatError(error));
      return {};
    }
  }

  /**
   * Phase 3: Review - critique the generated workflow and return structured feedback.
   */
  private async runReviewPhase(
    config: LocalLlmConfig,
    currentRequest: string,
    plan: string,
    generatedYaml: string,
    isSkill: boolean,
    appendInstructions: string | undefined,
    generationModal: WorkflowGenerationModal,
    signal: AbortSignal,
    isCancelled: () => boolean
  ): Promise<{ review?: ReviewResult; usage?: StreamChunkUsage }> {
    const workflowSpec = WORKFLOW_SPECIFICATION;
    const languageName = getLanguageName();

    const skillReviewChecks = isSkill
      ? `
5. **Skill instructions quality**: Are instructions written in imperative form? Do they explain WHY behind each guideline (not just rigid rules)? Are they concise (under 500 lines)?
6. **Skill description**: Does the description specify both what the skill does AND when to use it? Is it specific enough to trigger reliably?
7. **Input/output design**: Does the workflow have clear input variables for the AI to provide? Are outputs meaningful for continuing the conversation?`
      : "";

    const reviewSystemPrompt = `You are a workflow quality reviewer for Obsidian. Evaluate the generated workflow YAML against the original request and plan.

Check for:
1. **Completeness**: Does the workflow fulfill all aspects of the request?
2. **Correctness**: Are node types valid? Are connections (next, trueNext, falseNext) properly set? Are variables initialized before use? NOTE: The \`value\` field on a variable node is OPTIONAL — omitting it defaults to "" for new variables and preserves the existing value for variables already set (input declaration). Do NOT flag missing \`value\` as an issue; only flag real problems (wrong type, broken references, undefined variables being read, etc.).
   IMPORTANT: Do NOT flag "workflow does not output variable X to chat" as an issue. When a skill workflow runs, ALL variables whose name does not start with \`_\` are automatically returned to the chat AI, which presents them to the user as guided by the SKILL.md instructions. A final \`command\` node just to "display" a value is UNNECESSARY — a \`command\` node runs an LLM call inside the workflow and saves to a variable; it does not write directly to the chat. If the concern is that the user should see a specific variable, the fix belongs in the SKILL.md instructions body (e.g., "output \`ogpMarkdown\` verbatim"), not in the workflow YAML.
   IMPORTANT: A successful \`prompt-file\` node always resolves and validates a file before setting \`saveFileTo\`. In hotkey mode it uses the active Markdown file; otherwise it opens the picker. Cancellation, an invalid path, or a read failure throws and stops the workflow. Do NOT claim that execution can continue with an empty \`saveFileTo.path\`, and do NOT request a redundant script/if path-presence guard before a downstream \`rag-sync\` node. Flag the path only when \`saveFileTo\` itself is missing or the workflow references the wrong variable.
3. **Data flow**: Do saveTo variables match where they're referenced? Are there dangling references?
4. **Best practices**: Descriptive node IDs? Comments on complex nodes? Proper error handling?
5. **Variable interpolation in script nodes**: \`{{var:json}}\` does NOT add quotes — it only escapes content. Flag any occurrence where \`{{var:json}}\` appears without surrounding quotes in a JavaScript string context (e.g., \`var x = {{var:json}}\`, \`JSON.parse({{var:json}})\`). The correct form is \`"{{var:json}}"\` when the value should be a string literal.
6. **json node source**: The \`source\` field must be a bare variable name (no \`{{...}}\`, no surrounding quotes, no wrapping like \`"[{{var}}]"\`). Flag any \`source\` that uses interpolation or wrapping.${skillReviewChecks}

WORKFLOW SPECIFICATION (for reference):
${workflowSpec}

Output your review as JSON (no markdown code fences):
{
  "verdict": "pass" or "fail",
  "summary": "Brief overall assessment",
  "issues": [
    {
      "severity": "high" or "medium" or "low",
      "description": "Description of the issue"
    }
  ]
}

IMPORTANT:
- Write the "summary" and every issue "description" in ${languageName}.
- Use plain, non-technical language a non-engineer can understand (avoid jargon like node types, YAML field names, or variable references unless absolutely necessary).
- The JSON keys themselves ("verdict", "summary", "issues", "severity", "description") must remain in English.
- "high" severity: The workflow will fail or produce wrong results (missing variables, invalid node types, broken connections).
- "medium"/"low" severity: Quality improvements, not critical.
- Set verdict to "fail" only if there are "high" severity issues.
- If the workflow looks correct, return verdict "pass" with an empty issues array.`;

    const entityType = isSkill ? "skill" : "workflow";
    const planSection = plan ? `\nPLAN:\n${plan}\n` : "";
    const activeRequirementsSection = appendInstructions
      ? `\nADDITIONAL ACTIVE REQUIREMENTS:\n${appendInstructions}\n`
      : "";
    const reviewUserPrompt = `Review this generated ${entityType}:

ORIGINAL REQUEST:
${currentRequest}
${planSection}
${activeRequirementsSection}
GENERATED YAML:
${generatedYaml}`;

    try {
      let reviewText = "";
      let usage: StreamChunkUsage | undefined;
      const messages: Message[] = [{
        role: "user",
        content: reviewUserPrompt,
        timestamp: Date.now(),
      }];
      for await (const chunk of localLlmChatStream(
        config, messages, reviewSystemPrompt, signal
      )) {
        if (isCancelled()) return {};

        if (chunk.type === "thinking" && chunk.content) {
          generationModal.appendThinking(chunk.content);
        } else if (chunk.type === "text" && chunk.content) {
          reviewText += chunk.content;
          generationModal.appendReview(chunk.content);
        } else if (chunk.type === "done") {
          usage = chunk.usage;
        } else if (chunk.type === "error") {
          console.warn("Review phase error:", chunk.error);
          return {};
        }
      }
      return { review: parseReviewResponse(reviewText), usage };
    } catch (error) {
      console.warn("Review phase failed, proceeding without review:", formatError(error));
      return {};
    }
  }

  /**
   * Auto-refinement pass: regenerate the workflow using review feedback.
   * Returns the raw response text, or undefined if refinement fails.
   */
  private async runRefinementPass(
    config: LocalLlmConfig,
    currentRequest: string,
    plan: string,
    previousYaml: string,
    previousExplanation: string | undefined,
    review: ReviewResult,
    systemPrompt: string,
    isSkill: boolean,
    appendInstructions: string | undefined,
    generationModal: WorkflowGenerationModal,
    signal: AbortSignal,
    isCancelled: () => boolean
  ): Promise<{ response?: string; usage?: StreamChunkUsage }> {
    const issuesText = review.issues
      .map(i => `- [${i.severity}] ${i.description}`)
      .join("\n");

    const planSection = plan ? `\nPLAN:\n${plan}\n` : "";
    const activeRequirementsSection = appendInstructions
      ? `\nADDITIONAL ACTIVE REQUIREMENTS:\n${appendInstructions}\n`
      : "";

    let generatedOutput: string;
    let outputInstruction: string;
    if (isSkill && previousExplanation) {
      generatedOutput = `GENERATED SKILL.md INSTRUCTIONS:\n${previousExplanation}\n\nGENERATED YAML:\n${previousYaml}`;
      outputInstruction = `Fix all high-severity issues. Output the corrected SKILL.md instructions body first, then a line containing only "---", then the corrected complete YAML starting with "name:".`;
    } else {
      generatedOutput = `GENERATED YAML:\n${previousYaml}`;
      outputInstruction = `Fix all high-severity issues and output the corrected complete YAML, starting with "name:".`;
    }

    // When the reviewer produced unparseable JSON, include the full raw text
    // so the refinement model gets all the context rather than a truncated summary.
    const feedbackSection = review.rawText
      ? `REVIEW FEEDBACK (raw):\n${review.rawText}`
      : `REVIEW FEEDBACK:\n${review.summary}\n${issuesText}`;

    const refinementPrompt = `The following ${isSkill ? "skill" : "workflow"} was generated but the reviewer found issues that must be fixed:

ORIGINAL REQUEST:
${currentRequest}
${planSection}
${activeRequirementsSection}
${generatedOutput}

${feedbackSection}

${outputInstruction}`;

    try {
      let response = "";
      let usage: StreamChunkUsage | undefined;
      const messages: Message[] = [{
        role: "user",
        content: refinementPrompt,
        timestamp: Date.now(),
      }];
      for await (const chunk of localLlmChatStream(
        config, messages, systemPrompt, signal
      )) {
        if (isCancelled()) return {};

        if (chunk.type === "thinking" && chunk.content) {
          generationModal.appendThinking(chunk.content);
        } else if (chunk.type === "text" && chunk.content) {
          response += chunk.content;
        } else if (chunk.type === "done") {
          usage = chunk.usage;
        } else if (chunk.type === "error") {
          console.warn("Refinement pass error:", chunk.error);
          return {};
        }
      }
      return { response: response || undefined, usage };
    } catch (error) {
      console.warn("Refinement pass failed, using original generation:", formatError(error));
      return {};
    }
  }

  private buildSystemPrompt(outputAsMarkdown = false, isSkill = false): string {
    const workflowSpec = WORKFLOW_SPECIFICATION;

    const skillSpec = isSkill
      ? `

## Agent Skill Output Format

When creating a skill, generate TWO components:

### 1. SKILL.md Instructions
The body text that guides the AI assistant when this skill is activated in chat.

**Writing principles:**
- Use imperative form for instructions
- Explain the WHY behind each instruction rather than heavy-handed MUSTs — the AI is smart and responds better to understanding purpose than rigid rules
- Keep instructions concise (aim for under 500 lines)
- Include concrete examples with Input/Output format where helpful
- Define output formats explicitly when the skill produces structured results

**What to include:**
- Role description with clear persona (e.g., "You are a code review assistant specializing in...")
- Step-by-step behavioral guidelines explaining the reasoning behind each step
- When and how to invoke the workflow — reference each input variable by its **exact name** (as used in the workflow's \`{{var}}\` references) so the runtime's auto-derived \`inputVariables\` list matches what the body documents
- Edge cases and how to handle them

Example:
\`\`\`
You are a code review assistant. When reviewing code:

1. Check for common bugs and anti-patterns — these are the most impactful issues to catch early
2. Suggest improvements for readability, because code is read far more often than written
3. Verify error handling is adequate for production use
4. Use the workflow to run automated checks, passing the file path as the \`target\` variable

When the user shares code without explicit review requests, still offer brief observations about potential issues. This proactive approach helps catch problems before they grow.
\`\`\`

### 2. Workflow
An executable workflow in YAML format that the skill provides as a tool.
- Any variable you read via \`{{var}}\` without initializing (no preceding \`variable\` / \`set\` node and no \`saveTo\` target) becomes an **input variable**. The runtime extracts these automatically and writes them into SKILL.md's \`skill-capabilities\` fenced YAML block as \`workflows[0].inputVariables\`, so the chat LLM will see them when deciding what to pass to \`run_skill_workflow\`.
- Pick short, descriptive input variable names (e.g. \`filePath\`, \`query\`, \`mode\`). Avoid names starting with \`_\` — those are reserved for runtime-provided system variables.
- Save meaningful results to named variables that the chat LLM can consume after \`run_skill_workflow\` returns.

### SKILL.md layout (written for you)
You do NOT need to emit SKILL.md frontmatter or the capability block. The runtime constructs them from your output:
\`\`\`markdown
---
name: <skill name>
description: <skill description>
---

\`\`\`skill-capabilities
workflows:
  - path: workflows/workflow.md
    description: <skill name>
    inputVariables: [<derived from your workflow YAML>]
\`\`\`

<your SKILL.md instructions body goes here>
\`\`\`
- Frontmatter holds only user-facing metadata (name, description).
- Workflow IDs and their input variables live in the \`skill-capabilities\` fenced YAML block. The runtime fills this in; you just need the workflow YAML's \`{{var}}\` usage to be clean and unambiguous so the derived \`inputVariables\` list is correct.
- Your instructions prose should reference input variables by their exact name (so the LLM knows what to pass when invoking the workflow).
`
      : "";

    let outputRules: string;
    if (isSkill && outputAsMarkdown) {
      outputRules = `1. Output a Markdown document with two parts:
   a. SKILL.md instructions body (detailed AI behavioral guidelines) as plain text
   b. The workflow inside a \`\`\`llm-workflow code block
2. The text before the \`\`\`llm-workflow code block will be used as the SKILL.md instructions body
3. The YAML inside the code block must be valid and parseable
4. Include a descriptive "name" field
5. Use unique, descriptive node IDs (e.g., "read-input", "process-data", "save-result")
6. Ensure all variables are initialized before use
7. Use proper control flow (next, trueNext, falseNext)
8. Use the "comment" property on nodes to describe each step's purpose`;
    } else if (isSkill) {
      outputRules = `1. First, output the SKILL.md instructions body (detailed AI behavioral guidelines)
2. Then output a line containing only "---"
3. Then output the workflow YAML starting with "name:"
4. The YAML must be valid and parseable
5. Include a descriptive "name" field
6. Use unique, descriptive node IDs (e.g., "read-input", "process-data", "save-result")
7. Ensure all variables are initialized before use
8. Use proper control flow (next, trueNext, falseNext)`;
    } else if (outputAsMarkdown) {
      outputRules = `1. Output a Markdown document containing the workflow inside a \`\`\`llm-workflow code block
2. The YAML inside the code block must be valid and parseable
3. Include a descriptive "name" field
4. Use unique, descriptive node IDs (e.g., "read-input", "process-data", "save-result")
5. Ensure all variables are initialized before use
6. Use proper control flow (next, trueNext, falseNext)
7. Include a processing overview and description BEFORE the workflow code block as Markdown text
8. Use the "comment" property on nodes to describe each step's purpose`;
    } else {
      outputRules = `1. Output ONLY the workflow YAML, no explanation or markdown code fences
2. The YAML must be valid and parseable
3. Include a descriptive "name" field
4. Use unique, descriptive node IDs (e.g., "read-input", "process-data", "save-result")
5. Ensure all variables are initialized before use
6. Use proper control flow (next, trueNext, falseNext)
7. Start output directly with "name:" - no code fences, no explanation`;
    }

    const generatorType = isSkill ? "skill" : "workflow";
    return `You are a ${generatorType} generator for Obsidian. You create and modify workflows in YAML format.

${workflowSpec}${skillSpec}

IMPORTANT RULES:
${outputRules}`;
  }

  private buildUserPrompt(
    currentRequest: string,
    workflowName?: string,
    previousYaml?: string,
    requestHistory: string[] = [],
    selectedExecutionSteps?: ExecutionStep[],
    isSkill = false,
    plan?: string
  ): string {
    const body = this.buildUserPromptBody(
      currentRequest, workflowName, previousYaml, requestHistory,
      selectedExecutionSteps, isSkill, plan
    );
    return this.appendInstructions ? `${body}\n\n${this.appendInstructions}` : body;
  }

  /**
   * Build the generation user prompt body. `appendInstructions` (e.g. the
   * dashboard widget's headless output contract) is re-asserted by the
   * buildUserPrompt wrapper on every generation — including revisions — so it
   * stays active even when the original request is demoted to history.
   */
  private buildUserPromptBody(
    currentRequest: string,
    workflowName?: string,
    previousYaml?: string,
    requestHistory: string[] = [],
    selectedExecutionSteps?: ExecutionStep[],
    isSkill = false,
    plan?: string
  ): string {
    // Build plan section if available. The plan is written in plain language
    // (possibly in a non-English language) and describes WHAT the workflow should
    // do from the user's perspective — translate it into concrete workflow nodes.
    const planSection = plan
      ? `\nUSER-APPROVED PLAN (plain-language description of the desired behavior):\n${plan}\n\nTranslate this plan into concrete workflow nodes. The plan describes WHAT the workflow should do; you decide HOW (which nodes, variables, and connections to use).\n`
      : "";

    if (this.mode === "create") {
      const entityType = isSkill ? "skill" : "workflow";

      // If we have previous request/YAML from regeneration, include as reference
      if (requestHistory.length > 0 && previousYaml) {
        // Build numbered history of all requests
        const historySection = requestHistory.map((req, idx) => `${idx + 1}. ${req}`).join("\n");

        // Build execution history section if steps are selected
        let executionSection = "";
        if (selectedExecutionSteps && selectedExecutionSteps.length > 0) {
          executionSection = this.formatExecutionSteps(selectedExecutionSteps);
        }

        const completeOutputInstruction = isSkill
          ? `Output the SKILL.md instructions body and the complete workflow YAML for the skill named "${workflowName}".`
          : `Output only the complete YAML for the workflow, starting with "name: ${workflowName}".`;

        return `Create or modify a ${entityType} based on the following request.

REFERENCE (previous attempts):
${historySection}

Previous output:
${previousYaml}
${executionSection}${planSection}
NEW REQUEST:
${currentRequest}

${completeOutputInstruction}`;
      }

      const outputInstruction = isSkill
        ? `Output the SKILL.md instructions body and the workflow YAML for the skill named "${workflowName}".`
        : `Output only the YAML for the workflow, starting with "name: ${workflowName}".`;

      return `Create a new ${entityType} named "${workflowName}" that does the following:

${currentRequest}
${planSection}
${outputInstruction}`;
    } else {
      // Build execution history section if steps are selected
      let executionSection = "";
      if (selectedExecutionSteps && selectedExecutionSteps.length > 0) {
        executionSection = this.formatExecutionSteps(selectedExecutionSteps);
      }

      if (isSkill) {
        const instructionsSection = this.existingInstructions
          ? `\nCURRENT SKILL.md INSTRUCTIONS:\n${this.existingInstructions}\n`
          : "";
        return `Modify the following skill according to these requirements. The skill consists of SKILL.md instructions (persona/behavioral guidelines for the AI) AND an executable workflow YAML.
${instructionsSection}
CURRENT WORKFLOW YAML:
${this.existingYaml}
${executionSection}${planSection}
MODIFICATIONS REQUESTED:
${currentRequest}

Output the modified SKILL.md instructions body first, then a line containing only "---", then the modified complete YAML starting with "name:".`;
      }

      return `Modify the following workflow according to these requirements:

CURRENT WORKFLOW:
${this.existingYaml}
${executionSection}${planSection}
MODIFICATIONS REQUESTED:
${currentRequest}

Output only the complete modified YAML, starting with "name:".`;
    }
  }

  /**
   * Format execution steps for LLM context
   */
  private formatExecutionSteps(steps: ExecutionStep[]): string {
    if (steps.length === 0) return "";

    const formattedSteps = steps.map((step, idx) => {
      const lines: string[] = [];
      lines.push(`Step ${idx + 1} [${step.nodeType}] ${step.nodeId}:`);

      if (step.input && Object.keys(step.input).length > 0) {
        const inputStr = JSON.stringify(step.input, null, 2)
          .split("\n")
          .map(line => "  " + line)
          .join("\n");
        lines.push(`  Input: ${inputStr}`);
      }

      if (step.status === "error" && step.error) {
        lines.push(`  Error: ${step.error}`);
      } else if (step.output !== undefined) {
        const outputStr = typeof step.output === "string"
          ? step.output.substring(0, 500) + (step.output.length > 500 ? "..." : "")
          : JSON.stringify(step.output, null, 2).substring(0, 500);
        lines.push(`  Output: ${outputStr}`);
      }

      lines.push(`  Status: ${step.status}`);

      return lines.join("\n");
    }).join("\n\n");

    return `
EXECUTION HISTORY (selected steps):
${formattedSteps}

`;
  }

  /**
   * Strip YAML frontmatter from file content
   */
  private stripFrontmatter(content: string): string {
    // Match YAML frontmatter: starts with ---, ends with ---
    const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
    return content.replace(frontmatterRegex, "").trim();
  }

  private async resolveMentions(text: string): Promise<{ resolved: string; mentions: ResolvedMention[] }> {
    interface Occurrence extends MentionOccurrence {
      original: string;
      replacement: string;
      content: string;
    }
    const occurrences: Occurrence[] = [];

    // --- @{selection}: lift the editor selection into the prompt.
    const editor = this.app.workspace.activeEditor?.editor;
    if (editor && editor.somethingSelected()) {
      const content = editor.getSelection();
      const replacement = `[Selected text]\n${content}\n[/Selected text]`;
      for (const occ of findLiteralOccurrences(text, "@{selection}")) {
        occurrences.push({ ...occ, original: occ.matched, replacement, content });
      }
    }

    // --- @{content}: lift the active file's body into the prompt.
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      try {
        const rawContent = await this.app.vault.read(activeFile);
        const content = this.stripFrontmatter(rawContent);
        const replacement = `[Content of ${activeFile.path}]\n${content}\n[/Content]`;
        for (const occ of findLiteralOccurrences(text, "@{content}")) {
          occurrences.push({ ...occ, original: occ.matched, replacement, content });
        }
      } catch {
        // Leave the token as-is if the active file can't be read.
      }
    }

    // --- @path: scan the vault, longest path first, so file names with
    // spaces/unicode/regex-special chars resolve correctly and longer paths
    // take priority over shorter suffixes. Uses `getFiles()` (not
    // `getMarkdownFiles()`) so workflow-side mentions can reference any vault
    // file — `@workflows/foo.yaml`, `@config.json`, `@diagram.canvas`, etc.,
    // matching the previous `getAbstractFileByPath(token)` lookup behaviour.
    const files = this.app.vault.getFiles();
    const filePaths = files.map(f => f.path);
    const fileByPath = new Map<string, TFile>(files.map(f => [f.path, f]));
    const fileMatches = findFileMentionOccurrences(text, filePaths, { prefix: "@" });
    // Group hits by file so we only read each file once, regardless of how
    // many times it was mentioned.
    const hitsByPath = new Map<string, MentionOccurrence[]>();
    for (const m of fileMatches) {
      // Drop hits that collide with an already-recorded selection/content
      // occurrence (extremely rare — would require a vault file literally
      // named `{selection}.md` or similar).
      if (occurrences.some(o => !(m.end <= o.start || m.start >= o.end))) continue;
      const list = hitsByPath.get(m.key) ?? [];
      list.push(m);
      hitsByPath.set(m.key, list);
    }
    for (const [path, hits] of hitsByPath) {
      const file = fileByPath.get(path);
      if (!file) continue;
      try {
        const rawContent = await this.app.vault.read(file);
        const content = this.stripFrontmatter(rawContent);
        const replacement = `[Content of ${path}]\n${content}\n[/Content]`;
        for (const h of hits) {
          occurrences.push({ ...h, original: h.matched, replacement, content });
        }
      } catch {
        // Leave the token as-is if the file can't be read.
      }
    }

    // Splice in reverse order so earlier offsets stay valid as we rewrite.
    const spliced = occurrences.slice().sort((a, b) => b.start - a.start);
    let resolved = text;
    for (const o of spliced) {
      resolved = resolved.slice(0, o.start) + o.replacement + resolved.slice(o.end);
    }

    // Return mentions in text-order so downstream consumers see them in the
    // same order the user typed them.
    const mentions: ResolvedMention[] = occurrences
      .slice()
      .sort((a, b) => a.start - b.start)
      .map(o => ({ original: o.original, content: o.content }));

    return { resolved, mentions };
  }

  private parseResponse(response: string): AIWorkflowResult | null {
    return parseWorkflowResponse(response);
  }

  private setupDrag(header: HTMLElement, modalEl: HTMLElement): void {
    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") return;

      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;

      const rect = modalEl.getBoundingClientRect();
      this.modalStartX = rect.left;
      this.modalStartY = rect.top;

      modalEl.setCssStyles({
        position: "fixed",
        margin: "0",
        transform: "none",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
      });

      activeDocument.addEventListener("mousemove", onMouseMove);
      activeDocument.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging) return;

      const deltaX = e.clientX - this.dragStartX;
      const deltaY = e.clientY - this.dragStartY;

      modalEl.setCssStyles({
        left: `${this.modalStartX + deltaX}px`,
        top: `${this.modalStartY + deltaY}px`,
      });
    };

    const onMouseUp = () => {
      this.isDragging = false;
      activeDocument.removeEventListener("mousemove", onMouseMove);
      activeDocument.removeEventListener("mouseup", onMouseUp);
    };

    header.addEventListener("mousedown", onMouseDown);
  }

  private addResizeHandles(modalEl: HTMLElement): void {
    const directions = ["n", "e", "s", "w", "ne", "nw", "se", "sw"];
    for (const dir of directions) {
      const handle = modalEl.createDiv({ cls: `llm-hub-resize-handle llm-hub-resize-${dir}` });
      handle.dataset.direction = dir;
      this.setupResize(handle, modalEl, dir);
    }
  }

  private setupResize(handle: HTMLElement, modalEl: HTMLElement, direction: string): void {
    const onMouseDown = (e: MouseEvent) => {
      this.isResizing = true;
      this.resizeDirection = direction;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;

      const rect = modalEl.getBoundingClientRect();
      this.resizeStartWidth = rect.width;
      this.resizeStartHeight = rect.height;
      this.modalStartX = rect.left;
      this.modalStartY = rect.top;

      modalEl.setCssStyles({
        position: "fixed",
        margin: "0",
        transform: "none",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });

      activeDocument.addEventListener("mousemove", onMouseMove);
      activeDocument.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
      e.stopPropagation();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isResizing) return;

      const deltaX = e.clientX - this.dragStartX;
      const deltaY = e.clientY - this.dragStartY;
      const dir = this.resizeDirection;

      let newWidth = this.resizeStartWidth;
      let newHeight = this.resizeStartHeight;
      let newLeft = this.modalStartX;
      let newTop = this.modalStartY;

      if (dir.includes("e")) {
        newWidth = Math.max(400, this.resizeStartWidth + deltaX);
      }
      if (dir.includes("w")) {
        newWidth = Math.max(400, this.resizeStartWidth - deltaX);
        newLeft = this.modalStartX + (this.resizeStartWidth - newWidth);
      }
      if (dir.includes("s")) {
        newHeight = Math.max(300, this.resizeStartHeight + deltaY);
      }
      if (dir.includes("n")) {
        newHeight = Math.max(300, this.resizeStartHeight - deltaY);
        newTop = this.modalStartY + (this.resizeStartHeight - newHeight);
      }

      modalEl.setCssStyles({
        width: `${newWidth}px`,
        height: `${newHeight}px`,
        left: `${newLeft}px`,
        top: `${newTop}px`,
      });
    };

    const onMouseUp = () => {
      this.isResizing = false;
      activeDocument.removeEventListener("mousemove", onMouseMove);
      activeDocument.removeEventListener("mouseup", onMouseUp);
    };

    handle.addEventListener("mousedown", onMouseDown);
  }

  private setupMentionAutocomplete(): void {
    if (!this.descriptionEl || !this.mentionAutocompleteEl) return;

    const textarea = this.descriptionEl;
    const autocomplete = this.mentionAutocompleteEl;

    // Input handler for @ detection
    textarea.addEventListener("input", () => {
      const value = textarea.value;
      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = value.substring(0, cursorPos);
      const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);

      if (atMatch) {
        const query = atMatch[1];
        this.mentionStartPos = cursorPos - atMatch[0].length;
        this.mentionItems = this.buildMentionCandidates(query);
        this.mentionIndex = 0;

        if (this.mentionItems.length > 0) {
          this.showingMentionAutocomplete = true;
          this.renderMentionAutocomplete();
          this.positionAutocomplete(textarea, autocomplete);
          autocomplete.removeClass("is-hidden");
        } else {
          this.hideMentionAutocomplete();
        }
      } else {
        this.hideMentionAutocomplete();
      }
    });

    // Keyboard handler
    textarea.addEventListener("keydown", (e) => {
      if (!this.showingMentionAutocomplete) return;

      if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        this.mentionIndex = Math.min(this.mentionIndex + 1, this.mentionItems.length - 1);
        this.renderMentionAutocomplete();
        return;
      }
      if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        this.mentionIndex = Math.max(this.mentionIndex - 1, 0);
        this.renderMentionAutocomplete();
        return;
      }
      if (e.key === "Enter" && this.mentionItems.length > 0) {
        e.preventDefault();
        this.selectMention(this.mentionItems[this.mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        this.hideMentionAutocomplete();
        return;
      }
    });

    // Click outside to close (store handler for cleanup)
    this.clickOutsideHandler = (e: MouseEvent) => {
      if (this.showingMentionAutocomplete &&
          !autocomplete.contains(e.target as Node) &&
          e.target !== textarea) {
        this.hideMentionAutocomplete();
      }
    };
    activeDocument.addEventListener("click", this.clickOutsideHandler);
  }

  private buildMentionCandidates(query: string): MentionItem[] {
    const hasActiveNote = !!this.app.workspace.getActiveFile();
    const editor = this.app.workspace.activeEditor?.editor;
    const hasSelection = editor ? editor.somethingSelected() : false;

    const variables: MentionItem[] = [
      ...(hasSelection ? [{ value: "{selection}", description: "Selected text in editor" }] : []),
      ...(hasActiveNote ? [{ value: "{content}", description: "Content of active note" }] : []),
    ];

    // Get vault files
    const files = this.app.vault.getMarkdownFiles().map((f) => ({
      value: f.path,
      description: "Vault file",
    }));

    const all = [...variables, ...files];
    if (!query) return all.slice(0, 10);

    const lowerQuery = query.toLowerCase();
    return all.filter((item) => item.value.toLowerCase().includes(lowerQuery)).slice(0, 10);
  }

  private renderMentionAutocomplete(): void {
    if (!this.mentionAutocompleteEl) return;

    this.mentionAutocompleteEl.empty();
    this.mentionItems.forEach((item, index) => {
      const itemEl = this.mentionAutocompleteEl!.createDiv({
        cls: `llm-hub-autocomplete-item ${index === this.mentionIndex ? "active" : ""}`,
      });
      itemEl.createSpan({
        cls: "llm-hub-autocomplete-name",
        text: item.value,
      });
      itemEl.createSpan({
        cls: "llm-hub-autocomplete-desc",
        text: item.description,
      });

      itemEl.addEventListener("click", () => this.selectMention(item));
      itemEl.addEventListener("mouseenter", () => {
        this.mentionIndex = index;
        this.renderMentionAutocomplete();
      });
    });
  }

  private selectMention(mention: MentionItem): void {
    if (!this.descriptionEl) return;

    const textarea = this.descriptionEl;
    const cursorPos = textarea.selectionStart;
    const before = textarea.value.substring(0, this.mentionStartPos);
    const after = textarea.value.substring(cursorPos);
    // Keep @ prefix for later processing (file content embedding)
    const newValue = before + "@" + mention.value + " " + after;

    textarea.value = newValue;
    this.hideMentionAutocomplete();

    // Set cursor position after inserted mention (includes @)
    const newPos = this.mentionStartPos + 1 + mention.value.length + 1;
    textarea.setSelectionRange(newPos, newPos);
    textarea.focus();
  }

  private hideMentionAutocomplete(): void {
    this.showingMentionAutocomplete = false;
    if (this.mentionAutocompleteEl) {
      this.mentionAutocompleteEl.addClass("is-hidden");
    }
  }

  private positionAutocomplete(textarea: HTMLTextAreaElement, autocomplete: HTMLElement): void {
    const rect = textarea.getBoundingClientRect();

    // Position above the textarea using fixed positioning
    autocomplete.setCssStyles({
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      bottom: `${window.innerHeight - rect.top + 4}px`,
      top: "auto",
    });
  }

  onClose(): void {
    // Clean up event listener
    if (this.clickOutsideHandler) {
      activeDocument.removeEventListener("click", this.clickOutsideHandler);
      this.clickOutsideHandler = null;
    }
    const { contentEl } = this;
    contentEl.empty();
  }
}

// Helper function to open the modal
export function promptForAIWorkflow(
  app: App,
  plugin: LocalLlmHubPlugin,
  mode: AIWorkflowMode,
  existingYaml?: string,
  existingName?: string,
  defaultOutputPath?: string,
  options?: AIWorkflowModalOptions
): Promise<AIWorkflowResult | null> {
  return new Promise((resolve) => {
    const modal = new AIWorkflowModal(
      app,
      plugin,
      mode,
      resolve,
      existingYaml,
      existingName,
      defaultOutputPath,
      options
    );
    modal.open();
  });
}

/**
 * Parse a workflow response (from LLM or pasted YAML) into AIWorkflowResult.
 * Handles code-fenced YAML, raw YAML, and mixed text+YAML responses.
 */
export function parseWorkflowResponse(response: string): AIWorkflowResult | null {
  return parseWorkflowResponseWithError(response).result;
}

/**
 * Same as parseWorkflowResponse but also returns a machine-readable error message
 * describing why parsing failed — used to drive auto-repair by re-prompting the LLM.
 */
export function parseWorkflowResponseWithError(response: string): { result: AIWorkflowResult | null; error?: string } {
  try {
    let yaml = "";
    let yamlStartIdx = -1;

    const codeBlockRegex = /```\w*\s*([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRegex.exec(response)) !== null) {
      const content = match[1].trim();
      if (content.includes("name:") && content.includes("nodes:")) {
        yaml = content;
        yamlStartIdx = match.index;
        break;
      }
    }

    if (!yaml) {
      const nameMatch = response.match(/(?:^|\n)(name:\s*\S+[\s\S]*?nodes:\s*[\s\S]*?)(?:\n```|$)/);
      if (nameMatch && nameMatch.index !== undefined) {
        yaml = nameMatch[1].trim();
        yamlStartIdx = nameMatch.index;
      }
    }

    if (!yaml) {
      const startIdx = response.indexOf("name:");
      if (startIdx >= 0) {
        yaml = response.substring(startIdx).trim();
        yaml = yaml.replace(/\n```\s*$/, "").trim();
        yamlStartIdx = startIdx;
      }
    }

    if (!yaml) {
      return { result: null, error: "No workflow YAML found. The response must contain a YAML block starting with 'name:' and including 'nodes:'." };
    }

    let explanation = "";
    if (yamlStartIdx > 0) {
      explanation = response.substring(0, yamlStartIdx).trim();
      explanation = explanation.replace(/```\w*\s*$/gm, "").trim();
    }

    yaml = normalizeYamlText(yaml);
    let parsed: {
      name?: string;
      nodes?: Array<{
        id?: string;
        type?: string;
        next?: string;
        trueNext?: string;
        falseNext?: string;
        [key: string]: unknown;
      }>;
    };
    try {
      parsed = parseYaml(yaml) as typeof parsed;
    } catch (yamlErr) {
      return { result: null, error: `YAML syntax error: ${formatError(yamlErr)}` };
    }

    if (!parsed || typeof parsed !== "object") {
      return { result: null, error: "Parsed YAML is not an object." };
    }
    if (!Array.isArray(parsed.nodes)) {
      return { result: null, error: "Parsed YAML has no 'nodes' array at the top level." };
    }

    const nodes: SidebarNode[] = parsed.nodes.map((node, index) => {
      const { id, type, next, trueNext, falseNext, ...properties } = node;

      const stringProps: Record<string, string> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (value === null || value === undefined) {
          stringProps[key] = "";
        } else if (typeof value === "object") {
          stringProps[key] = JSON.stringify(value);
        } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          stringProps[key] = String(value);
        } else {
          stringProps[key] = JSON.stringify(value);
        }
      }

      const sidebarNode: SidebarNode = {
        id: String(id || `node-${index + 1}`),
        type: (type || "variable") as WorkflowNodeType,
        properties: stringProps,
      };

      if (next) sidebarNode.next = String(next);
      if (trueNext) sidebarNode.trueNext = String(trueNext);
      if (falseNext) sidebarNode.falseNext = String(falseNext);

      return sidebarNode;
    });

    return {
      result: {
        yaml,
        nodes,
        name: parsed.name || "AI Generated Workflow",
        explanation: explanation || undefined,
      },
    };
  } catch (error) {
    return { result: null, error: formatError(error) };
  }
}

/** Render generation context (plan/thinking/review) as collapsible details sections.
 *  The plan and review sections are rendered as Markdown; thinking kept as preformatted text. */
export function renderGenerationContext(
  container: HTMLElement,
  ctx: GenerationContext,
  app: App,
  component: Component,
  options?: { defaultOpen?: boolean }
): void {
  const sections: { label: string; content: string; kind: "markdown" | "text" }[] = [];
  if (ctx.plan) sections.push({ label: t("workflow.generation.phasePlan"), content: ctx.plan, kind: "markdown" });
  if (ctx.review) sections.push({ label: t("workflow.generation.phaseReview"), content: ctx.review, kind: "markdown" });
  if (ctx.thinking) sections.push({ label: t("workflow.generation.thinking"), content: ctx.thinking, kind: "text" });

  if (sections.length === 0) return;

  const defaultOpen = options?.defaultOpen ?? true;
  const wrapper = container.createDiv({ cls: "llm-hub-workflow-generation-context" });
  for (const section of sections) {
    const details = wrapper.createEl("details", { cls: "llm-hub-workflow-generation-context-details" });
    // Open plan/review by default when they're the primary content (preview modal).
    // Keep them closed in contexts where the diff is primary (confirm modal).
    if (defaultOpen && section.kind === "markdown") details.setAttr("open", "");
    const summary = details.createEl("summary");
    summary.createSpan({ text: section.label });
    createCopyButton(summary, () => section.content);
    if (section.kind === "markdown") {
      const mdContainer = details.createDiv({ cls: "llm-hub-workflow-generation-context-content llm-hub-workflow-generation-plan-rendered" });
      void MarkdownRenderer.render(app, section.content, mdContainer, "/", component);
      continue;
    }
    const pre = details.createEl("pre", { cls: "llm-hub-workflow-generation-context-content" });
    pre.textContent = section.content;
  }
}

/** Merge multiple StreamChunkUsage objects by summing their numeric fields */
function mergeUsage(a?: StreamChunkUsage, b?: StreamChunkUsage): StreamChunkUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    thinkingTokens: (a.thinkingTokens ?? 0) + (b.thinkingTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
  };
}

/** Structured result from the review phase */
export interface ReviewResult {
  verdict: "pass" | "fail";
  summary: string;
  issues: Array<{
    severity: "high" | "medium" | "low";
    description: string;
  }>;
  /** Raw reviewer text preserved when JSON parsing fails, so refinement gets full context */
  rawText?: string;
}

/**
 * Format a ReviewResult as localized Markdown for human-readable display.
 */
export function formatReviewAsMarkdown(review: ReviewResult): string {
  const severityLabel: Record<string, string> = {
    high: t("workflow.generation.severityHigh"),
    medium: t("workflow.generation.severityMedium"),
    low: t("workflow.generation.severityLow"),
  };
  const severityIcon: Record<string, string> = {
    high: "🔴",
    medium: "🟡",
    low: "🔵",
  };

  const verdictIcon = review.verdict === "pass" ? "✅" : "⚠️";
  const verdictLabel = review.verdict === "pass"
    ? t("workflow.generation.reviewVerdictPass")
    : t("workflow.generation.reviewVerdictFail");

  const lines: string[] = [];
  lines.push(`## ${verdictIcon} ${verdictLabel}`);
  if (review.summary) {
    lines.push("");
    lines.push(review.summary);
  }

  if (review.issues.length > 0) {
    lines.push("");
    lines.push(`### ${t("workflow.generation.reviewIssues")} (${review.issues.length})`);
    lines.push("");
    for (const issue of review.issues) {
      const icon = severityIcon[issue.severity] || "";
      const label = severityLabel[issue.severity] || issue.severity;
      lines.push(`- ${icon} **[${label}]** ${issue.description}`);
    }
  } else if (review.verdict === "pass") {
    lines.push("");
    lines.push(`_${t("workflow.generation.reviewNoIssues")}_`);
  }

  return lines.join("\n");
}

/**
 * Parse the review phase response into a structured ReviewResult.
 */
function parseReviewResponse(response: string): ReviewResult {
  try {
    // Strip markdown code fences if present
    let jsonStr = response.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const verdict = parsed.verdict === "fail" ? "fail" : "pass";
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    const issues: ReviewResult["issues"] = [];

    if (Array.isArray(parsed.issues)) {
      for (const item of parsed.issues) {
        if (item && typeof item === "object" && "description" in item) {
          const severity = (item as { severity?: string }).severity;
          issues.push({
            severity: severity === "high" || severity === "medium" || severity === "low" ? severity : "medium",
            description: String((item as { description: unknown }).description),
          });
        }
      }
    }

    return { verdict, summary, issues };
  } catch {
    // JSON parse failed — the reviewer likely flagged real issues but
    // produced malformed output. Treat as "fail" so refinement runs
    // with the raw text, rather than silently accepting.
    console.warn("Failed to parse review response as JSON, treating as fail");
    return {
      verdict: "fail",
      summary: response.trim().substring(0, 500),
      issues: [{ severity: "high", description: "Review output could not be parsed; refinement triggered with raw reviewer feedback" }],
      rawText: response.trim(),
    };
  }
}
