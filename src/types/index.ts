import type { ToolCall } from "obsidian-llm-hub-common/chat";

export type { Message, ToolCall, ToolResult, Attachment, RagCitation } from "obsidian-llm-hub-common/chat";
import type { WorkflowEventTrigger } from "obsidian-llm-hub-common/workflow";

export type { ObsidianEventType, WorkflowEventTrigger } from "obsidian-llm-hub-common/workflow";
// Supported LLM frameworks
export type LlmFramework = "ollama" | "lm-studio" | "anythingllm" | "vllm";

// Vault tool mode for RAG
export type VaultToolMode = "all" | "noSearch" | "readOnly" | "none";
// "auto" is a legacy value kept for stored configs; it behaves like "extract-text".
export type PdfInputMode = "auto" | "native" | "extract-text";

// Local LLM configuration (OpenAI-compatible API)
export interface LocalLlmConfig {
  framework: LlmFramework;     // Which LLM framework is being used
  baseUrl: string;              // e.g. "http://localhost:11434" (Ollama) or "http://localhost:1234" (LM Studio)
  model: string;                // e.g. "llama3", "mistral", "gemma2"
  apiKey?: string;              // Optional API key (for services that require it)
  temperature?: number;         // 0.0-2.0 (undefined = server default)
  maxTokens?: number;           // Max response tokens (undefined = server default)
  streamIdleTimeoutSeconds?: number; // Seconds without streamed data before aborting (undefined = 120)
  pdfInputMode?: PdfInputMode;  // auto defaults to extracted text for local servers
}

export const DEFAULT_LOCAL_LLM_CONFIG: LocalLlmConfig = {
  framework: "ollama",
  baseUrl: "http://localhost:11434",
  model: "",
};

export interface LocalLlmProfile {
  config: LocalLlmConfig;
  availableModels: string[];
  verified: boolean;
}

// RAG chunking strategy
export type ChunkStrategy = "fixed" | "sentence" | "block";

// One cited RAG chunk with its location in the source document.
// NOTE: note-content excerpts (e.g. `snippet`) are intentionally NOT persisted
// here, because ragCitations are serialized into saved chat history. Only the
// location fields needed for navigation are kept; tooltip previews are derived
// at runtime from the chunk text.

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
  maxPreviousMessages?: number;      // Older chat messages sent with the current one (0-99)
  sentPromptHistory?: string[];
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
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolParameter>;
  required?: string[];
  items?: ToolParameter;
}

// Tool call from LLM response

// Tool execution result associated with a tool call.
// `result` may be a parsed object (e.g. JSON response) or raw string.

// Chat message types


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
  type: "text" | "thinking" | "tool_call" | "incomplete_tool_call" | "error" | "done" | "replace_text";
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


// MCP server configuration (stdio transport)
// MCP stdio framing protocol
export type McpFraming = "content-length" | "newline";

export interface AgentPluginInstall {
  name: string;
  repo: string;
  version: string;
  sourceType: "release" | "branch";
  sourceRef: string;
  commitSha: string;
  enabled: boolean;
  skillNames: string[];
  executables?: string[];
}

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  framing: McpFraming;
  enabled: boolean;
  autoApprove?: boolean;
  allowedTools?: string[];
  toolHints?: string[];
  cwd?: string;
  pluginRoot?: string;
  pluginData?: string;
  agentPlugin?: { pluginName: string; serverName: string };
}

export interface KnowledgeSource {
  id: string;
  name: string;
  path: string;
  type: "okf";
  enabled: boolean;
  activeBundleIds?: string[];
}

// Plugin settings
export interface LocalLlmHubSettings {
  lastAIWorkflowModel?: string;  // Model last used for AI workflow generation
  llmConfig: LocalLlmConfig;
  llmVerified: boolean;
  availableModels: string[];
  llmProfiles: Record<string, LocalLlmProfile>;
  selectedLlmProfile: string;
  /** Legacy RAG settings kept for migration only. Use WorkspaceState.ragSettings instead. */
  ragConfig?: RagConfig;
  saveChatHistory: boolean;
  maxSavedChatHistories: number;
  manualChatSaveFolder: string;
  systemPrompt: string;
  encryption: EncryptionSettings;
  editHistory: EditHistorySettings;
  slashCommands: SlashCommand[];
  enabledWorkflowHotkeys: string[];
  enabledWorkflowEventTriggers: WorkflowEventTrigger[];
  /** Vault-relative folder used for plugin-generated data. */
  workspaceFolder: string;
  /** Vault-relative folder containing user-installed skills. */
  skillsFolder: string;
  hideWorkspaceFolder: boolean;
  /** Vault-relative folders that LLM-driven vault tools may access. Empty allows the whole vault. */
  vaultToolAllowedFolders: string[];
  lastSelectedWorkflowPath?: string;
  /** Last used model for Timeline AI rewrite. */
  lastTimelineAiModel?: string;
  knowledgeSources: KnowledgeSource[];
  mcpServers: McpServerConfig[];
  agentPlugins: AgentPluginInstall[];
  /** Vault tool mode for the chat input (all | noSearch | none). */
  vaultToolMode: VaultToolMode;
  /**
   * Per-request per-MCP-server selection persisted in the chat input, stored as an
   * opt-out map keyed by server id: a value of false means "disabled", while a key
   * that is absent means "default" (enabled). Absence is the crucial signal that
   * lets us tell an unset selection apart from an explicit choice to disable.
   *
   * We deliberately moved away from an allow-list of "enabled ids": with an
   * allow-list, an unset field serializes as the same [] value as "user disabled
   * everything", which made fresh/first users default every connected server OFF on
   * next reload and let reconnect races silently flip saved state.
   */
  mcpServerEnabled?: Partial<Record<string, boolean>>;
}

/** Fixed skills folder name. */
export const SKILLS_FOLDER = "skills";
/** Fixed workflows folder name. */
export const WORKFLOWS_FOLDER = "workflows";
/** Basename (no extension) of a skill definition file: skills/<dir>/SKILL.md. */
export const SKILL_FILE_BASENAME = "SKILL";
/** Default workspace folder name. */
export const WORKSPACE_FOLDER = "LocalLlmHub";

export const DEFAULT_SETTINGS: LocalLlmHubSettings = {
  llmConfig: DEFAULT_LOCAL_LLM_CONFIG,
  llmVerified: false,
  availableModels: [],
  llmProfiles: {},
  selectedLlmProfile: "Default",
  saveChatHistory: true,
  maxSavedChatHistories: 100,
  manualChatSaveFolder: "",
  systemPrompt: "",
  encryption: { ...DEFAULT_ENCRYPTION_SETTINGS },
  editHistory: { ...DEFAULT_EDIT_HISTORY_SETTINGS },
  slashCommands: [],
  enabledWorkflowHotkeys: [],
  enabledWorkflowEventTriggers: [],
  workspaceFolder: WORKSPACE_FOLDER,
  skillsFolder: SKILLS_FOLDER,
  hideWorkspaceFolder: true,
  vaultToolAllowedFolders: [],
  knowledgeSources: [],
  mcpServers: [],
  agentPlugins: [],
  vaultToolMode: "all",
};
