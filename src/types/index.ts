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

// RAG chunking strategy
export type ChunkStrategy = "fixed" | "sentence" | "block";

// One cited RAG chunk with its location in the source document.
// NOTE: note-content excerpts (e.g. `snippet`) are intentionally NOT persisted
// here, because ragCitations are serialized into saved chat history. Only the
// location fields needed for navigation are kept; tooltip previews are derived
// at runtime from the chunk text.
export interface RagCitation {
  filePath: string;
  heading?: string;      // nearest Markdown heading ("" when none)
  startOffset: number;   // chunk start offset in the source document
  snippet?: string;      // optional preview; NOT populated for persisted citations
  pageLabel?: string;    // PDF page range, e.g. "pages 2-5 of 24"
}

// Named RAG setting (one per index)
export interface RagSetting {
  embeddingModel: string;       // e.g. "nomic-embed-text"
  embeddingBaseUrl: string;     // separate embedding server URL (empty = same as LLM)
  chunkSize: number;            // characters per chunk
  chunkOverlap: number;         // overlap between chunks
  chunkStrategy: ChunkStrategy;   // chunking strategy (default: "fixed")
  topK: number;                 // number of results to retrieve
  minScore: number;             // minimum cosine similarity score to include (0.0-1.0)
  targetFolders: string[];      // folders to index (empty = all)
  excludePatterns: string[];    // regex patterns to exclude
  externalIndexPath: string;    // absolute path to external index directory (empty = vault sync)
  sourceRagSettings: string[];  // names of internal RAG settings to merge (empty = standalone)
  lastFullSync: number | null;  // timestamp of last full sync
}

export const DEFAULT_RAG_SETTING: RagSetting = {
  embeddingModel: "nomic-embed-text",
  embeddingBaseUrl: "",
  chunkSize: 1000,
  chunkOverlap: 200,
  chunkStrategy: "fixed",
  topK: 5,
  minScore: 0.3,
  targetFolders: [],
  excludePatterns: [],
  externalIndexPath: "",
  sourceRagSettings: [],
  lastFullSync: null,
};

// Workspace state (persisted in workspace-state.json)
export interface WorkspaceState {
  selectedRagSetting: string | null;
  ragSettings: Record<string, RagSetting>;
}

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  selectedRagSetting: null,
  ragSettings: {},
};

/** Legacy RAG settings shape kept for migration from old settings. */
export interface RagConfig {
  enabled: boolean;
  embeddingModel: string;
  embeddingBaseUrl?: string;
  targetFolders: string[];
  excludePatterns: string[];
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  minScore: number;
  externalIndexPath?: string;
}

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

// Tool execution result associated with a tool call.
// `result` may be a parsed object (e.g. JSON response) or raw string.
export interface ToolResult {
  toolCallId: string;
  result: unknown;
}

// Chat message types
export interface Attachment {
  name: string;
  type: "image" | "pdf" | "text" | "audio" | "video";
  mimeType: string;
  data: string;  // Base64 encoded
  sourcePath?: string;  // RAG検索結果のソースファイルパス
  pageLabel?: string;  // PDFページ範囲（例: "pages 1-6 of 24"）
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  llmContent?: string;          // full content sent to the LLM (hidden from UI)
  timestamp: number;
  model?: string;               // model name (assistant only)
  attachments?: Attachment[];
  thinking?: string;            // thinking content (thinking models)
  ragUsed?: boolean;            // whether RAG was used
  ragSources?: string[];        // source files from RAG
  ragCitations?: RagCitation[];   // per-chunk citation locations (new chats)
  skillsUsed?: string[];        // names of skills used
  toolCalls?: ToolCall[];       // tool calls made by assistant
  toolResults?: ToolResult[];   // results of tool calls (keyed by toolCallId)
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
  // `replace_text` instructs the consumer to overwrite the accumulated text
  // buffer with `content`. Used to strip inline tool-call JSON out of the
  // visible response after it has already been streamed.
  type: "text" | "thinking" | "tool_call" | "error" | "done" | "replace_text";
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
  workflowId: string; // Vault path to the workflow file (e.g., "folder/file.md"). Each file holds exactly one workflow.
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
  /** Legacy RAG settings kept for migration only. Use WorkspaceState.ragSettings instead. */
  ragConfig?: RagConfig;
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
/** Basename (no extension) of a skill definition file: skills/<dir>/SKILL.md. */
export const SKILL_FILE_BASENAME = "SKILL";
/** Fixed workspace folder name. */
export const WORKSPACE_FOLDER = "LocalLlmHub";

export const DEFAULT_SETTINGS: LocalLlmHubSettings = {
  llmConfig: DEFAULT_LOCAL_LLM_CONFIG,
  llmVerified: false,
  availableModels: [],
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
