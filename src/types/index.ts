// Local LLM configuration (OpenAI-compatible API)
export interface LocalLlmConfig {
  baseUrl: string;              // e.g. "http://localhost:11434" (Ollama) or "http://localhost:1234" (LM Studio)
  model: string;                // e.g. "llama3", "mistral", "gemma2"
  apiKey?: string;              // Optional API key (for services that require it)
  temperature?: number;         // 0.0-2.0 (undefined = server default)
  maxTokens?: number;           // Max response tokens (undefined = server default)
  enableThinking?: boolean;     // Whether the model supports thinking (e.g. DeepSeek, QwQ)
}

export const DEFAULT_LOCAL_LLM_CONFIG: LocalLlmConfig = {
  baseUrl: "http://localhost:11434",
  model: "",
};

// Local RAG configuration
export interface RagConfig {
  enabled: boolean;
  embeddingModel: string;       // e.g. "nomic-embed-text"
  embeddingBaseUrl: string;     // defaults to LLM server baseUrl
  targetFolders: string[];      // folders to index (empty = all)
  excludePatterns: string[];    // regex patterns to exclude
  chunkSize: number;            // characters per chunk
  chunkOverlap: number;         // overlap between chunks
  topK: number;                 // number of results to retrieve
}

export const DEFAULT_RAG_CONFIG: RagConfig = {
  enabled: false,
  embeddingModel: "nomic-embed-text",
  embeddingBaseUrl: "",
  targetFolders: [],
  excludePatterns: [],
  chunkSize: 1000,
  chunkOverlap: 200,
  topK: 5,
};

// Chat message types
export interface Attachment {
  name: string;
  type: "image" | "pdf" | "text" | "audio" | "video";
  mimeType: string;
  data: string;  // Base64 encoded
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  model?: string;               // model name (assistant only)
  attachments?: Attachment[];
  thinking?: string;            // thinking content (thinking models)
  ragUsed?: boolean;            // whether RAG was used
  ragSources?: string[];        // source files from RAG
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
  type: "text" | "thinking" | "error" | "done";
  content?: string;
  error?: string;
  usage?: StreamChunkUsage;
}

// Plugin settings
export interface LocalLlmHubSettings {
  llmConfig: LocalLlmConfig;
  llmVerified: boolean;
  ragConfig: RagConfig;
  workspaceFolder: string;
  saveChatHistory: boolean;
  systemPrompt: string;
}

export const DEFAULT_SETTINGS: LocalLlmHubSettings = {
  llmConfig: DEFAULT_LOCAL_LLM_CONFIG,
  llmVerified: false,
  ragConfig: DEFAULT_RAG_CONFIG,
  workspaceFolder: "LocalLlmHub",
  saveChatHistory: true,
  systemPrompt: "",
};
