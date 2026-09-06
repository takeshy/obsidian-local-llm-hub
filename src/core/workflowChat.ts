import { localLlmChatStream } from "src/core/localLlmProvider";
import type { LocalLlmHubPlugin } from "src/plugin";
import type { WorkflowChatChunk, WorkflowChatRequest } from "obsidian-llm-hub-common/workflow";

/**
 * Runs a workflow generation prompt against the configured local model. This is the plugin's half
 * of WorkflowHost: the shared modal knows nothing about the local server or its config.
 */
export async function* streamWorkflowChat(
  plugin: LocalLlmHubPlugin,
  request: WorkflowChatRequest,
): AsyncGenerator<WorkflowChatChunk> {
  const config = request.model
    ? { ...plugin.settings.llmConfig, model: request.model }
    : plugin.settings.llmConfig;
  const messages = [{ role: "user" as const, content: request.userPrompt, timestamp: Date.now() }];

  // Workflow generation only cares about prose, reasoning and the final tally.
  for await (const chunk of localLlmChatStream(config, messages, request.systemPrompt, request.abortSignal)) {
    if (chunk.type === "text" || chunk.type === "thinking" || chunk.type === "done" || chunk.type === "error") {
      yield { type: chunk.type, content: chunk.content, usage: chunk.usage, error: chunk.error };
    }
  }
}
