import { TFile } from "obsidian";
import type { LocalLlmHubPlugin } from "src/plugin";
import { localLlmChatStream } from "src/core/localLlmProvider";
import { getVaultTools } from "src/core/tools";
import { executeToolCall } from "src/core/toolExecutor";
import { loadBuiltinSkill, builtinFolderPath } from "src/core/builtinSkills";
import { WORKFLOW_SPECIFICATION } from "src/workflow/workflowSpec";
import type { Message, ToolCall, ToolDefinition } from "src/types";
import { parseWorkflowFromMarkdown } from "src/workflow/parser";
import { WorkflowExecutor } from "src/workflow/executor";
import type { PromptCallbacks, WorkflowInput } from "src/workflow/types";

export interface DashboardAiModel { id: string; name: string; capabilities: { text: boolean; vaultRead: boolean; tools: boolean } }
interface WorkflowRequest { workflowPath: string; outputVariable?: string; abortSignal?: AbortSignal }
interface BaseRequest { modelId: string; instruction: string; currentYaml?: string; basePath?: string; allowVaultRead: boolean; previousResult?: string; abortSignal?: AbortSignal }
interface RewriteRequest { modelId: string; content: string; instruction: string; previousResult?: string; context: "timeline" | "memo"; abortSignal?: AbortSignal }
interface WorkflowGenerationRequest { modelId: string; mode: "create" | "modify"; instruction: string; currentMarkdown?: string; previousResult?: string; outputContract: { outputVariable: string; format: "markdown" | "html" }; allowVaultRead: boolean; abortSignal?: AbortSignal }

export function listDashboardModels(plugin: LocalLlmHubPlugin): DashboardAiModel[] {
  const names = [...new Set([plugin.settings.llmConfig.model, ...plugin.settings.availableModels].filter(Boolean))];
  return names.map((id) => ({ id, name: id, capabilities: { text: true, vaultRead: true, tools: true } }));
}
function headlessCallbacks(): PromptCallbacks {
  return { promptForFile: () => Promise.resolve(null), promptForAnyFile: () => Promise.resolve(null), promptForNewFilePath: () => Promise.resolve(null),
    promptForSelection: () => Promise.resolve(null), promptForValue: () => Promise.resolve(null),
    promptForConfirmation: () => Promise.resolve({ action: "cancel" as const }), promptForDialog: () => Promise.resolve(null), promptForPassword: () => Promise.resolve(null) };
}
function extract(values: Map<string, string | number>, name?: string): string | null {
  const str = (value: unknown) => typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
  if (name) return str(values.get(name)); const result = str(values.get("result")); if (result != null) return result;
  for (const [key, value] of values) { const text = str(value); if (!key.startsWith("_") && text) return text; } return null;
}
export async function runDashboardWorkflow(plugin: LocalLlmHubPlugin, request: WorkflowRequest): Promise<string> {
  const file = plugin.app.vault.getAbstractFileByPath(request.workflowPath);
  if (!(file instanceof TFile)) throw new Error(`Workflow not found: ${request.workflowPath}`);
  const workflow = parseWorkflowFromMarkdown(await plugin.app.vault.read(file));
  const input: WorkflowInput = { variables: new Map() };
  const execution = await new WorkflowExecutor(plugin.app, plugin).execute(workflow, input, undefined, {
    workflowPath: file.path, workflowName: file.basename, recordHistory: false,
    abortSignal: request.abortSignal ?? new AbortController().signal,
  }, headlessCallbacks());
  const text = extract(execution.context.variables, request.outputVariable);
  if (text == null) throw new Error("Workflow output is not a string. Store it in `result`, or set Output variable.");
  return text;
}

const READ_TOOLS = new Set(["read_timeline", "read_note", "search_notes", "list_notes", "list_folders", "get_active_note"]);
async function generate(plugin: LocalLlmHubPlugin, modelId: string, prompt: string, systemPrompt: string, signal?: AbortSignal, vaultRead = false): Promise<string> {
  const config = { ...plugin.settings.llmConfig, model: modelId };
  const tools: ToolDefinition[] | undefined = vaultRead ? getVaultTools("all").filter((tool) => READ_TOOLS.has(tool.function.name)) : undefined;
  const conversation: Message[] = [{ role: "user", content: prompt, timestamp: Date.now() }];
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
      const result = await executeToolCall(call, { app: plugin.app });
      conversation.push({ role: "tool", content: result.result, timestamp: Date.now(), toolCallId: call.id, toolName: call.name });
    }
  }
  throw new Error("AI exceeded the read-only tool-call limit.");
}
function stripFence(text: string): string { return text.replace(/^\s*```(?:ya?ml)?\s*/i, "").replace(/\s*```\s*$/, "").trim(); }
function baseSystem(): string { const skill = loadBuiltinSkill(builtinFolderPath("obsidian-bases")); return `Return only valid Obsidian Bases YAML. Verify real properties with read-only Vault tools when available.\n\n${skill ? `${skill.instructions}\n${skill.references.join("\n\n")}` : ""}`; }
export async function generateDashboardBase(plugin: LocalLlmHubPlugin, request: BaseRequest): Promise<string> {
  const source = request.previousResult || request.currentYaml;
  return stripFence(await generate(plugin, request.modelId, source ? `Revise this Base.\nInstruction: ${request.instruction}\n\nCurrent YAML:\n${source}` : `Create an Obsidian Base.\nInstruction: ${request.instruction}`,
    baseSystem(), request.abortSignal, request.allowVaultRead));
}
export function rewriteDashboardText(plugin: LocalLlmHubPlugin, request: RewriteRequest): Promise<string> {
  return generate(plugin, request.modelId, `Instruction: ${request.instruction}\n\nText:\n${request.previousResult || request.content}`,
    `Rewrite the ${request.context} text. Return only rewritten text.`, request.abortSignal);
}
export function generateDashboardWorkflow(plugin: LocalLlmHubPlugin, request: WorkflowGenerationRequest): Promise<string> {
  const source = request.previousResult || request.currentMarkdown;
  return generate(plugin, request.modelId,
    `${request.mode === "modify" ? "Revise" : "Create"} an unattended Obsidian Workflow.\nInstruction: ${request.instruction}\nOutput ${request.outputContract.format} to ${request.outputContract.outputVariable}.${source ? `\n\nCurrent workflow:\n${source}` : ""}`,
    `Return only a complete Markdown document with a workflow YAML block. Do not use interactive nodes.\n\n${WORKFLOW_SPECIFICATION}`,
    request.abortSignal, request.allowVaultRead);
}
