import { App } from "obsidian";
import type { LocalLlmHubPlugin } from "../../plugin";
import type { StreamChunkUsage, Message } from "../../types";
import { localLlmChatStream } from "../../core/localLlmProvider";
import { WorkflowNode, ExecutionContext, FileExplorerData, PromptCallbacks } from "../types";
import { replaceVariables } from "./utils";

// Result type for command node execution
export interface CommandNodeResult {
  usedModel: string;
  usage?: StreamChunkUsage;
  elapsedMs?: number;
}

// Handle command node - execute LLM with prompt using local LLM provider
export async function handleCommandNode(
  node: WorkflowNode,
  context: ExecutionContext,
  _app: App,
  plugin: LocalLlmHubPlugin,
  promptCallbacks?: PromptCallbacks,
): Promise<CommandNodeResult> {
  const promptTemplate = node.properties["prompt"];
  if (!promptTemplate) {
    throw new Error("Command node missing 'prompt' property");
  }

  // Replace variables in prompt
  let prompt = replaceVariables(promptTemplate, context);
  const originalPrompt = prompt;

  // Check if this is a regeneration request for this node
  if (context.regenerateInfo?.commandNodeId === node.id) {
    const info = context.regenerateInfo;
    prompt = `${info.originalPrompt}

[Previous output]
${info.previousOutput}

[User feedback]
${info.additionalRequest}

Please revise the output based on the user's feedback above.`;
    context.regenerateInfo = undefined;
  }

  const llmConfig = plugin.settings.llmConfig;
  const enableThinking = node.properties["enableThinking"] !== "false" && !!llmConfig.enableThinking;

  // Parse attachments property (comma-separated variable names containing FileExplorerData)
  const attachmentsStr = node.properties["attachments"] || "";
  const attachments: Message["attachments"] = [];

  if (attachmentsStr) {
    const varNames = attachmentsStr.split(",").map((s) => s.trim()).filter((s) => s);
    for (const varName of varNames) {
      const varValue = context.variables.get(varName);
      if (varValue && typeof varValue === "string") {
        try {
          const fileData: FileExplorerData = JSON.parse(varValue);
          if (fileData.contentType === "binary" && fileData.data) {
            let attachmentType: "image" | "pdf" | "text" | "audio" | "video" = "text";
            if (fileData.mimeType.startsWith("image/")) {
              attachmentType = "image";
            } else if (fileData.mimeType === "application/pdf") {
              attachmentType = "pdf";
            } else if (fileData.mimeType.startsWith("audio/")) {
              attachmentType = "audio";
            } else if (fileData.mimeType.startsWith("video/")) {
              attachmentType = "video";
            }
            attachments.push({
              name: fileData.basename,
              type: attachmentType,
              mimeType: fileData.mimeType,
              data: fileData.data,
            });
          }
        } catch {
          // Not valid FileExplorerData JSON, skip
        }
      }
    }
  }

  // Build messages for the LLM
  const messages: Message[] = [
    {
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
    },
  ];

  // Execute LLM call via local provider
  let fullResponse = "";
  let thinkingContent = "";
  let streamUsage: StreamChunkUsage | undefined;
  const apiStartTime = Date.now();

  const systemPrompt = plugin.settings.systemPrompt || "You are a helpful AI assistant integrated with Obsidian.";

  for await (const chunk of localLlmChatStream(
    llmConfig,
    messages,
    systemPrompt,
    undefined, // No abort signal from workflow executor (handled externally)
    enableThinking ? true : undefined,
  )) {
    if (chunk.type === "text") {
      fullResponse += chunk.content || "";
    } else if (chunk.type === "thinking") {
      thinkingContent += chunk.content || "";
      // Stream thinking content to the progress modal
      promptCallbacks?.onThinking?.(node.id, thinkingContent);
    } else if (chunk.type === "error") {
      throw new Error(chunk.error || "Unknown API error");
    } else if (chunk.type === "done") {
      streamUsage = chunk.usage;
      break;
    }
  }

  // Save response to variable if specified
  const saveTo = node.properties["saveTo"];
  if (saveTo) {
    context.variables.set(saveTo, fullResponse);
    context.lastCommandInfo = {
      nodeId: node.id,
      originalPrompt,
      saveTo,
    };
  }

  return {
    usedModel: llmConfig.model || "local-llm",
    usage: streamUsage,
    elapsedMs: Date.now() - apiStartTime,
  };
}
