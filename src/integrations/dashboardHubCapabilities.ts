import { buildSkillSystemPrompt, collectSkillWorkflows, type LoadedSkill } from "src/core/skillsLoader";
import type { LocalLlmHubPlugin } from "src/plugin";
import { localLlmChatStream } from "src/core/localLlmProvider";
import { getVaultTools, readNoteTool, skillWorkflowTool } from "src/core/tools";
import { executeToolCall } from "src/core/toolExecutor";
import { loadBuiltinSkill, builtinFolderPath } from "src/core/builtinSkills";
import { WORKFLOW_SPECIFICATION } from "src/workflow/workflowSpec";
import { getRagStore } from "src/core/ragStore";
import { runSkillWorkflow } from "obsidian-llm-hub-common/workflow";
import {
  assertTimelineAnswerSupported, dashboardBasePrompt, dashboardRewritePrompt, dashboardWorkflowPrompt,
  listDashboardSkills, loadDashboardSkills, runDashboardWorkflow as runWorkflow, stripYamlFence,
  timelineAnswerMessages, timelineAnswerSystemPrompt,
  type DashboardAiModel, type DashboardBaseRequest, type DashboardRewriteRequest, type DashboardTimelineAnswerOptions,
  type DashboardTimelineAnswerRequest, type DashboardWorkflowGenerationRequest, type DashboardWorkflowRequest,
} from "obsidian-llm-hub-common/dashboard";
import type { Message, ToolCall, ToolDefinition } from "src/types";

export type { DashboardAiModel };
export type TimelineAnswerRequest = DashboardTimelineAnswerRequest;
export type TimelineAnswerOptions = DashboardTimelineAnswerOptions;

export function listDashboardModels(plugin: LocalLlmHubPlugin): DashboardAiModel[] {
  const names = [...new Set([plugin.settings.llmConfig.model, ...plugin.settings.availableModels].filter(Boolean))];
  return names.map((id) => ({ id, name: id, capabilities: { text: true, vaultRead: true, tools: true } }));
}

export function runDashboardWorkflow(plugin: LocalLlmHubPlugin, request: DashboardWorkflowRequest): Promise<string> {
  return runWorkflow(plugin.app, request);
}

const READ_TOOLS = new Set(["read_timeline", "read_note", "search_notes", "list_notes", "list_folders", "get_active_note"]);
async function generate(plugin: LocalLlmHubPlugin, modelId: string, prompt: string | Message[], systemPrompt: string, signal?: AbortSignal, vaultRead = false, mcpServerIds: string[] = [], skills: LoadedSkill[] = []): Promise<string> {
  const config = { ...plugin.settings.llmConfig, model: modelId };
  const vaultTools = vaultRead ? getVaultTools("all").filter((tool) => READ_TOOLS.has(tool.function.name)) : [];
  const mcpTools = mcpServerIds.length > 0 ? plugin.mcpManager.getAllTools(mcpServerIds) : [];
  // As in Chat: a vault skill's SKILL.md is reached through read_note, and skill
  // workflows run in the usual execution modal.
  const workflows = collectSkillWorkflows(skills);
  const skillTools = [
    ...(skills.some((skill) => !skill.instructions) && !vaultRead ? [readNoteTool] : []),
    ...(workflows.size > 0 ? [skillWorkflowTool] : []),
  ];
  const all = [...vaultTools, ...mcpTools, ...skillTools];
  const tools: ToolDefinition[] | undefined = all.length > 0 ? all : undefined;
  const conversation: Message[] = typeof prompt === "string" ? [{ role: "user", content: prompt, timestamp: Date.now() }] : [...prompt];
  for (let round = 0; round < 12; round += 1) {
    let output = ""; const calls: ToolCall[] = [];
    for await (const chunk of localLlmChatStream(config, conversation, systemPrompt, signal, tools)) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (chunk.type === "text" && chunk.content) output += chunk.content;
      else if (chunk.type === "replace_text") output = chunk.content ?? "";
      else if (chunk.type === "tool_call" && chunk.toolCall) calls.push(chunk.toolCall);
      else if (chunk.type === "error") throw new Error(chunk.error || "AI generation failed.");
    }
    if (calls.length === 0) { if (!output.trim()) throw new Error("AI returned an empty response."); return output.trim(); }
    conversation.push({ role: "assistant", content: output, timestamp: Date.now(), toolCalls: calls });
    for (const call of calls) {
      // executeToolCall dispatches any known tool, so refuse names that were never offered.
      if (!tools?.some((tool) => tool.function.name === call.name)) {
        conversation.push({ role: "tool", content: `Tool is not available: ${call.name}`, timestamp: Date.now(), toolCallId: call.id, toolName: call.name });
        continue;
      }
      const result = await executeToolCall(call, {
        app: plugin.app,
        vaultToolAllowedFolders: plugin.settings.vaultToolAllowedFolders,
        ...(mcpTools.length > 0 ? { mcpManager: plugin.mcpManager } : {}),
        ...(workflows.size > 0 ? {
          onRunSkillWorkflow: async (workflowId: string, variables: string | undefined) => JSON.stringify(await runSkillWorkflow(
            plugin.app, workflowId, variables, workflows, { vaultToolAllowedFolders: plugin.settings.vaultToolAllowedFolders })),
        } : {}),
      });
      conversation.push({ role: "tool", content: result.result, timestamp: Date.now(), toolCallId: call.id, toolName: call.name });
    }
  }
  throw new Error("AI exceeded the read-only tool-call limit.");
}

export async function generateDashboardBase(plugin: LocalLlmHubPlugin, request: DashboardBaseRequest): Promise<string> {
  const { prompt, systemPrompt } = dashboardBasePrompt(request, loadBuiltinSkill(builtinFolderPath("obsidian-bases")));
  return stripYamlFence(await generate(plugin, request.modelId, prompt, systemPrompt, request.abortSignal, request.allowVaultRead));
}
export function rewriteDashboardText(plugin: LocalLlmHubPlugin, request: DashboardRewriteRequest): Promise<string> {
  const { prompt, systemPrompt } = dashboardRewritePrompt(request);
  return generate(plugin, request.modelId, prompt, systemPrompt, request.abortSignal);
}
export function generateDashboardWorkflow(plugin: LocalLlmHubPlugin, request: DashboardWorkflowGenerationRequest): Promise<string> {
  const { prompt, systemPrompt } = dashboardWorkflowPrompt(request, WORKFLOW_SPECIFICATION);
  return generate(plugin, request.modelId, prompt, systemPrompt, request.abortSignal, request.allowVaultRead);
}

export async function getDashboardTimelineOptions(plugin: LocalLlmHubPlugin): Promise<TimelineAnswerOptions> {
  // AnythingLLM has no tool calling and answers from its own workspace documents,
  // so Chat offers neither the local RAG index, MCP, nor skills there.
  if (plugin.settings.llmConfig.framework === "anythingllm") return { vaultRead: true, webSearch: false, ragSettings: [], mcpServers: [], skills: [] };
  return {
    vaultRead: true,
    webSearch: false,
    ragSettings: plugin.getRagSettingNames().filter((name) => plugin.getRagSearchSetting(name) !== null),
    // Only connected servers can be used.
    mcpServers: plugin.mcpManager.getServerInfos().map((info) => info.name),
    skills: await listDashboardSkills(plugin.app, plugin.settings.skillsFolder),
  };
}

export async function answerDashboardTimeline(plugin: LocalLlmHubPlugin, request: TimelineAnswerRequest): Promise<string> {
  assertTimelineAnswerSupported(request, { webSearch: false });
  const anythingLlm = plugin.settings.llmConfig.framework === "anythingllm";
  let ragContext: string | undefined;
  if (request.ragSetting) {
    const setting = plugin.getRagSearchSetting(request.ragSetting);
    if (!setting) throw new Error(`RAG setting "${request.ragSetting}" was not found.`);
    const results = await getRagStore().search(request.ragSetting, request.question, setting, { ...plugin.settings.llmConfig, model: request.modelId }, plugin.app);
    if (results.length > 0) {
      ragContext = "\n\nRelevant excerpts from the user's RAG index. Prefer them over guessing and cite file paths when you use them:\n"
        + results.map((result) => `--- ${result.filePath}${result.heading ? ` # ${result.heading}` : ""}${result.pageLabel ? ` (${result.pageLabel})` : ""}\n${result.text}`).join("\n\n");
    }
  }
  const mcpServerIds = anythingLlm ? []
    : plugin.mcpManager.getServerInfos().filter((info) => request.mcpServers?.includes(info.name)).map((info) => info.id);
  const skills = anythingLlm ? [] : await loadDashboardSkills(plugin.app, plugin.settings.skillsFolder, request.skills);
  const systemPrompt = timelineAnswerSystemPrompt({
    vaultRead: request.allowVaultRead, ragContext, mcp: mcpServerIds.length > 0,
    skillPrompt: buildSkillSystemPrompt(skills), additionalInstructions: plugin.settings.systemPrompt,
  });
  return generate(plugin, request.modelId, timelineAnswerMessages(request), systemPrompt, request.abortSignal, request.allowVaultRead === true, mcpServerIds, skills);
}
