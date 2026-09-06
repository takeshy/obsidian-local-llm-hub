// Workflow vocabulary lives in obsidian-llm-hub-common; this file adds what only this plugin has.
import type { EditConfirmationResult } from "src/ui/components/workflow/EditConfirmationModal";

declare module "obsidian-llm-hub-common/workflow" {
  interface WorkflowHostCallbacks {
    promptForConfirmation: (
      filePath: string,
      content: string,
      mode: string,
      originalContent?: string
    ) => Promise<EditConfirmationResult>;
  }
}

export * from "obsidian-llm-hub-common/workflow";
