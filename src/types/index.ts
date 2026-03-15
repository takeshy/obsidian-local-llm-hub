// Supported LLM frameworks
export type LlmFramework = "ollama" | "lm-studio" | "anythingllm" | "vllm";

// Vault tool mode for RAG
export type VaultToolMode = "all" | "noSearch" | "none";

// Local LLM configuration (OpenAI-compatible API)
export interface LocalLlmConfig {
  framework: LlmFramework;     // Which LLM framework is being used
  baseUrl: string;              // e.g. "http://localhost:11434" (Ollama) or "http://localhost:1234" (LM Studio)
  model: string;                // e.g. "llama3", "mistral", "gemma2"
  apiKey?: string;              // Optional API key (for services that require it)
  temperature?: number;         // 0.0-2.0 (undefined = server default)
  maxTokens?: number;           // Max response tokens (undefined = server default)
}

export const DEFAULT_LOCAL_LLM_CONFIG: LocalLlmConfig = {
  framework: "ollama",
  baseUrl: "http://localhost:11434",
  model: "",
};

// Local RAG configuration
export interface RagConfig {
  enabled: boolean;
  embeddingModel: string;       // e.g. "nomic-embed-text"
  embeddingBaseUrl?: string;    // separate embedding server URL (empty = same as LLM)
  targetFolders: string[];      // folders to index (empty = all)
  excludePatterns: string[];    // regex patterns to exclude
  chunkSize: number;            // characters per chunk
  chunkOverlap: number;         // overlap between chunks
  topK: number;                 // number of results to retrieve
}

export const DEFAULT_RAG_CONFIG: RagConfig = {
  enabled: false,
  embeddingModel: "nomic-embed-text",
  targetFolders: [],
  excludePatterns: [],
  chunkSize: 1000,
  chunkOverlap: 200,
  topK: 5,
};

// Tool definitions (OpenAI-compatible format, shared by Ollama and LM Studio)
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameter>;
      required?: string[];
    };
  };
}

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
}

// Tool call from LLM response
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// Chat message types
export interface Attachment {
  name: string;
  type: "image" | "pdf" | "text" | "audio" | "video";
  mimeType: string;
  data: string;  // Base64 encoded
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  model?: string;               // model name (assistant only)
  attachments?: Attachment[];
  thinking?: string;            // thinking content (thinking models)
  ragUsed?: boolean;            // whether RAG was used
  ragSources?: string[];        // source files from RAG
  skillsUsed?: string[];        // names of skills used
  toolCalls?: ToolCall[];       // tool calls made by assistant
  toolCallId?: string;          // tool call ID (for tool role messages, LM Studio)
  toolName?: string;            // tool name (for tool role messages, Ollama)
  usage?: StreamChunkUsage;
  elapsedMs?: number;
}

// Usage info for streaming chunks and messages
export interface StreamChunkUsage {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  totalTokens?: number;
}

// Streaming chunk types
export interface StreamChunk {
  type: "text" | "thinking" | "tool_call" | "error" | "done";
  content?: string;
  toolCall?: ToolCall;
  error?: string;
  usage?: StreamChunkUsage;
}

// Encryption settings
export interface EncryptionSettings {
  enabled: boolean;
  encryptChatHistory: boolean;
  encryptWorkflowHistory: boolean;
  publicKey: string;
  encryptedPrivateKey: string;
  salt: string;
}

export const DEFAULT_ENCRYPTION_SETTINGS: EncryptionSettings = {
  enabled: false,
  encryptChatHistory: false,
  encryptWorkflowHistory: false,
  publicKey: "",
  encryptedPrivateKey: "",
  salt: "",
};

// Edit history settings
export interface EditHistorySettings {
  enabled: boolean;
  diff: {
    contextLines: number;
  };
}

export const DEFAULT_EDIT_HISTORY_SETTINGS: EditHistorySettings = {
  enabled: true,
  diff: {
    contextLines: 3,
  },
};

// Slash command
export interface SlashCommand {
  id: string;
  name: string;
  promptTemplate: string;
  description?: string;
  vaultToolMode?: VaultToolMode | null; // null = use current setting
}

// Obsidian event types for workflow triggers
export type ObsidianEventType = "create" | "modify" | "delete" | "rename" | "file-open";

// Workflow event trigger
export interface WorkflowEventTrigger {
  workflowId: string; // "path#name" format
  events: ObsidianEventType[];
  filePattern?: string;
}

// MCP server configuration (stdio transport)
// MCP stdio framing protocol
export type McpFraming = "content-length" | "newline";

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  framing: McpFraming;
  enabled: boolean;
}

// Plugin settings
export interface LocalLlmHubSettings {
  llmConfig: LocalLlmConfig;
  llmVerified: boolean;
  availableModels: string[];
  ragConfig: RagConfig;
  saveChatHistory: boolean;
  systemPrompt: string;
  encryption: EncryptionSettings;
  editHistory: EditHistorySettings;
  slashCommands: SlashCommand[];
  enabledWorkflowHotkeys: string[];
  enabledWorkflowEventTriggers: WorkflowEventTrigger[];
  hideWorkspaceFolder: boolean;
  lastSelectedWorkflowPath?: string;
  mcpServers: McpServerConfig[];
}

/** Fixed skills folder name. */
export const SKILLS_FOLDER = "skills";
/** Fixed workflows folder name. */
export const WORKFLOWS_FOLDER = "workflows";
/** Fixed workspace folder name. */
export const WORKSPACE_FOLDER = "LocalLlmHub";

export const DEFAULT_SETTINGS: LocalLlmHubSettings = {
  llmConfig: DEFAULT_LOCAL_LLM_CONFIG,
  llmVerified: false,
  availableModels: [],
  ragConfig: DEFAULT_RAG_CONFIG,
  saveChatHistory: true,
  systemPrompt: "",
  encryption: { ...DEFAULT_ENCRYPTION_SETTINGS },
  editHistory: { ...DEFAULT_EDIT_HISTORY_SETTINGS },
  slashCommands: [],
  enabledWorkflowHotkeys: [],
  enabledWorkflowEventTriggers: [],
  hideWorkspaceFolder: true,
  mcpServers: [],
};
