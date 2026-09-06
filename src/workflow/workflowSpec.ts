// The workflow format the AI writes against lives in the shared library, beside the
// executor it describes. This file only tells it what this plugin offers.
import type { LocalLlmHubPlugin } from "src/plugin";
import {
  getWorkflowSpecification,
  handleGetWorkflowSpec as handleSharedGetWorkflowSpec,
  GET_WORKFLOW_SPEC_TOOL as SHARED_GET_WORKFLOW_SPEC_TOOL,
  type WorkflowSpecContext,
} from "obsidian-llm-hub-common/workflow";
import { toOpenAiTool } from "obsidian-llm-hub-common/core";
import type { ToolDefinition } from "src/types";

export {
  getWorkflowSpecification,
  getWorkflowNodeSpec,
  WORKFLOW_SPECIFICATION,
  GET_WORKFLOW_SPEC_TOOL_NAME,
  type WorkflowSpecContext,
} from "obsidian-llm-hub-common/workflow";

// Local models are told about tools in the OpenAI wire shape, so the shared definition
// is wrapped rather than duplicated.
export const GET_WORKFLOW_SPEC_TOOL: ToolDefinition = toOpenAiTool(SHARED_GET_WORKFLOW_SPEC_TOOL);

/** Build the spec context from the plugin's current settings & workspace state. */
export function buildWorkflowSpecContext(plugin: LocalLlmHubPlugin): WorkflowSpecContext {
  // The configured local model is the only one a command node can run.
  return {
    modelNames: [plugin.settings.llmConfig.model].filter(Boolean),
    mcpServers: plugin.settings.mcpServers,
    ragSettingNames: Object.keys(plugin.wsManager.workspaceState.ragSettings),
  };
}

export function handleGetWorkflowSpec(
  args: Record<string, unknown>,
  plugin: LocalLlmHubPlugin,
): string {
  return handleSharedGetWorkflowSpec(args, buildWorkflowSpecContext(plugin)).result;
}

/** The spec as this plugin's current configuration renders it. */
export function getPluginWorkflowSpecification(plugin: LocalLlmHubPlugin): string {
  return getWorkflowSpecification(buildWorkflowSpecContext(plugin));
}
