import { App } from "obsidian";
import type { LocalLlmHubPlugin } from "../../plugin";
import type { StreamChunkUsage, Message, ToolCall, ToolDefinition } from "../../types";
import { localLlmChatStream } from "../../core/localLlmProvider";
import { getVaultTools } from "../../core/tools";
import { executeToolCall } from "../../core/toolExecutor";
import { WorkflowNode, ExecutionContext, FileExplorerData, PromptCallbacks } from "../types";
import { replaceVariables } from "./utils";

const MAX_TOOL_ROUNDS = 20;

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
  app: App,
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

  // Build tools: vault tools + MCP tools
  const useTools = node.properties["enableTools"] !== "false";
  let tools: ToolDefinition[] | undefined;
  if (useTools) {
    const vaultTools = getVaultTools("noSearch");
    const mcpTools = plugin.mcpManager.getAllTools();
    const combined = [...vaultTools, ...mcpTools];
    tools = combined.length > 0 ? combined : undefined;
  }

  // Build messages for the LLM
  const conversationMessages: Message[] = [
    {
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
    },
  ];

  // Execute LLM call via local provider with tool loop
  let fullResponse = "";
  let thinkingContent = "";
  let streamUsage: StreamChunkUsage | undefined;
  const apiStartTime = Date.now();

  const systemPrompt = plugin.settings.systemPrompt || "You are a helpful AI assistant integrated with Obsidian.";

  const streamOneRound = async (useToolsThisRound: boolean): Promise<ToolCall[]> => {
    const pendingToolCalls: ToolCall[] = [];
    fullResponse = "";

    for await (const chunk of localLlmChatStream(
      llmConfig,
      conversationMessages,
      systemPrompt,
      undefined,
      useToolsThisRound ? tools : undefined,
    )) {
      if (chunk.type === "text") {
        fullResponse += chunk.content || "";
      } else if (chunk.type === "thinking") {
        thinkingContent += chunk.content || "";
        promptCallbacks?.onThinking?.(node.id, thinkingContent);
      } else if (chunk.type === "tool_call") {
        if (chunk.toolCall) {
          pendingToolCalls.push(chunk.toolCall);
        }
      } else if (chunk.type === "error") {
        throw new Error(chunk.error || "Unknown API error");
      } else if (chunk.type === "done") {
        streamUsage = chunk.usage;
        break;
      }
    }
    return pendingToolCalls;
  };

  // First round
  let pendingToolCalls: ToolCall[];
  try {
    pendingToolCalls = await streamOneRound(!!tools);
  } catch {
    // If tools fail, retry without tools
    if (tools) {
      pendingToolCalls = await streamOneRound(false);
    } else {
      throw new Error("LLM call failed");
    }
  }

  // Tool call loop
  let toolRound = 0;
  while (pendingToolCalls.length > 0 && toolRound < MAX_TOOL_ROUNDS) {
    const assistantMsg: Message = {
      role: "assistant",
      content: fullResponse,
      timestamp: Date.now(),
      toolCalls: pendingToolCalls,
    };
    conversationMessages.push(assistantMsg);

    for (const tc of pendingToolCalls) {
      const result = await executeToolCall(tc, {
        app,
        mcpManager: plugin.mcpManager,
      });
      const toolResultMsg: Message = {
        role: "tool",
        content: result.result,
        timestamp: Date.now(),
        toolCallId: tc.id,
        toolName: tc.name,
      };
      conversationMessages.push(toolResultMsg);
    }

    toolRound++;
    pendingToolCalls = await streamOneRound(true);
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
