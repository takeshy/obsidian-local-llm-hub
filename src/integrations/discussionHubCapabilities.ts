import type { EventRef } from "obsidian";
import { localLlmChatStream } from "src/core/localLlmProvider";
import type { LocalLlmHubPlugin } from "src/plugin";
import type { Attachment, Message } from "src/types";

interface DiscussionAttachment { name: string; mimeType: string; data: string; type?: "image" | "pdf" | "text" | "audio" | "video"; sourcePath?: string }
interface DiscussionIntegration {
  protocolVersion: 1;
  id: string;
  name: string;
  listModels: () => Promise<Array<{ id: string; name: string }>>;
  streamText: (request: { modelId: string; messages: Array<{ role: "user" | "assistant"; content: string; attachments?: DiscussionAttachment[] }>; systemPrompt: string; abortSignal?: AbortSignal; onChunk: (text: string) => void }) => Promise<void>;
}
interface DiscussionHubApi { registerIntegration: (integration: DiscussionIntegration) => () => void }
interface DiscussionWorkspaceEvents {
  on: (name: "discussion-hub:ready", callback: (hub: DiscussionHubApi) => void) => EventRef;
  trigger: {
    (name: "discussion-hub:register-integration", integration: DiscussionIntegration): void;
    (name: "discussion-hub:unregister-integration", request: { id: string; integration: DiscussionIntegration }): void;
  };
}

function asAttachment(value: DiscussionAttachment): Attachment {
  return {
    name: value.name,
    mimeType: value.mimeType,
    data: value.data,
    type: value.type ?? (value.mimeType.startsWith("image/") ? "image" : value.mimeType === "application/pdf" ? "pdf" : "text"),
    sourcePath: value.sourcePath,
  };
}

export function registerDiscussionHubIntegration(plugin: LocalLlmHubPlugin): void {
  const integration: DiscussionIntegration = {
    protocolVersion: 1,
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    listModels: () => Promise.resolve([...new Set([plugin.settings.llmConfig.model, ...plugin.settings.availableModels].filter(Boolean))]
      .map((model) => ({ id: model, name: model }))),
    streamText: async ({ modelId, messages, systemPrompt, abortSignal, onChunk }) => {
      const config = { ...plugin.settings.llmConfig, model: modelId };
      const converted: Message[] = messages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: Date.now(),
        attachments: message.attachments?.map(asAttachment),
      }));
      for await (const chunk of localLlmChatStream(config, converted, systemPrompt, abortSignal)) {
        if (chunk.type === "text" && chunk.content) onChunk(chunk.content);
        else if (chunk.type === "error") throw new Error(chunk.error || "Local LLM discussion failed.");
      }
    },
  };
  const workspace = plugin.app.workspace as unknown as DiscussionWorkspaceEvents;
  plugin.registerEvent(workspace.on("discussion-hub:ready", (hub) => hub.registerIntegration(integration)));
  workspace.trigger("discussion-hub:register-integration", integration);
  plugin.register(() => workspace.trigger("discussion-hub:unregister-integration", { id: integration.id, integration }));
}
