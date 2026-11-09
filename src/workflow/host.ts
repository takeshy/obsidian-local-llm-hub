import { configureWorkflowHost, type WorkflowHost } from "obsidian-llm-hub-common/workflow";
import type { LocalLlmHubPlugin } from "../plugin";
import { SKILLS_FOLDER } from "../types";
import { streamWorkflowChat } from "../core/workflowChat";
import { WORKFLOW_SPECIFICATION } from "./workflowSpec";
import { handleCommandNode } from "./handlers/command";
import { handleRagSyncNode } from "./handlers/ragSync";

// RAG sync is optional for shared hosts, but required by this plugin.
type LocalWorkflowHost = WorkflowHost & Required<Pick<WorkflowHost, "runRagSyncNode">>;

export function configureLocalWorkflowHost(plugin: LocalLlmHubPlugin): void {
  const host: LocalWorkflowHost = {
    getModelOptions: () => (plugin.settings.availableModels || []).map(model => ({ value: model, label: model })),
    getRagSettingNames: () => plugin.getRagSettingNames(),
    getMcpServerNames: () => (plugin.settings.mcpServers || []).map(server => server.name),
    getCurrentModel: () => plugin.settings.llmConfig.model || "",
    getLastWorkflowModel: () => plugin.settings.lastAIWorkflowModel,
    setLastWorkflowModel: (model) => {
      plugin.settings.lastAIWorkflowModel = model;
      void plugin.saveSettings();
    },
    getWorkflowSpecification: () => WORKFLOW_SPECIFICATION,
    getWorkspaceFolder: () => plugin.settings.workspaceFolder,
    getSkillsFolder: () => plugin.settings.skillsFolder || SKILLS_FOLDER,
    notifySkillsChanged: () => plugin.settingsEmitter.emit("skills-changed"),
    getHistoryEncryption: () => plugin.settings.encryption,
    getPluginVersion: () => plugin.manifest.version,
    getWorkflowHotkeys: () => plugin.settings.enabledWorkflowHotkeys,
    setWorkflowHotkeys: (paths) => {
      plugin.settings.enabledWorkflowHotkeys = paths;
      void plugin.saveSettings();
    },
    getWorkflowEventTriggers: () => plugin.settings.enabledWorkflowEventTriggers,
    setWorkflowEventTriggers: (triggers) => {
      plugin.settings.enabledWorkflowEventTriggers = triggers;
      void plugin.saveSettings();
    },
    runWorkflowFromHotkey: (path) => {
      void plugin.workflowManager.executeFromHotkey(path);
    },
    getLastSelectedWorkflow: () => plugin.settings.lastSelectedWorkflowPath,
    setLastSelectedWorkflow: (path) => {
      plugin.settings.lastSelectedWorkflowPath = path;
      void plugin.saveSettings();
    },
    streamChat: (request) => streamWorkflowChat(plugin, request),
    runRagSyncNode: ({ node, context, app, abortSignal }) =>
      handleRagSyncNode(node, context, app, plugin, abortSignal),
    runCommandNode: ({ node, context, app, callbacks, traceId, abortSignal }) =>
      handleCommandNode(node, context, app, plugin, callbacks, traceId, abortSignal),
  };
  configureWorkflowHost(host);
}
