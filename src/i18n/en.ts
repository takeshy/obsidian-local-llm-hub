// English translations (base language)
export const en = {
  // Common
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.error": "Error: ",
  "common.close": "Close",

  // Settings - LLM
  "settings.llm": "LLM connection", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- LLM is an acronym
  "settings.llmDesc": "OpenAI-compatible API (Ollama, LM Studio, llama.cpp, vLLM, etc.)", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- proper nouns
  "settings.llmConfigure": "Configure LLM", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- LLM is an acronym
  "settings.llmVerifying": "Verifying connection...",
  "settings.llmVerified": "LLM verified", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- LLM is an acronym
  "settings.llmDisabled": "LLM disabled", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- LLM is an acronym
  "settings.llmConnectionFailed": "Connection failed: ",
  "settings.llmNoModel": "Please configure a model name in settings first",
  "settings.llmConfigSaved": "LLM settings saved", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- LLM is an acronym
  "settings.verified": "Verified",
  "settings.verify": "Verify",
  "settings.disable": "Disable",

  // Settings - LLM Modal
  "settings.llmModal.title": "LLM settings", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- LLM is an acronym
  "settings.llmModal.desc": "Configure a local LLM server with OpenAI-compatible API. Supports Ollama, LM Studio, llama.cpp, vLLM, LocalAI, and more.", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- proper nouns
  "settings.llmModal.baseUrl": "Base URL",
  "settings.llmModal.baseUrlDesc": "Server endpoint URL (e.g. http://localhost:11434 for Ollama, http://localhost:1234 for LM Studio)",
  "settings.llmModal.baseUrlRequired": "Base URL is required",
  "settings.llmModal.apiKey": "API key (optional)",
  "settings.llmModal.apiKeyDesc": "Required by some providers for authentication",
  "settings.llmModal.apiKeyPlaceholder": "sk-...", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- placeholder value
  "settings.llmModal.model": "Model",
  "settings.llmModal.modelDesc": "Select from server or type manually",
  "settings.llmModal.modelPlaceholder": "e.g. llama3, mistral, gemma2", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- placeholder with model names
  "settings.llmModal.fetchModels": "Fetch models",
  "settings.llmModal.fetching": "Fetching...",
  "settings.llmModal.noModelsFound": "No models found on the server",
  "settings.llmModal.modelsLoaded": "{{count}} model(s) loaded",
  "settings.llmModal.testConnection": "Test connection",
  "settings.llmModal.testing": "Testing...",
  "settings.llmModal.connectionSuccess": "Connected successfully",
  "settings.llmModal.connectionFailed": "Connection failed",
  "settings.llmModal.enableThinking": "Enable thinking",
  "settings.llmModal.enableThinkingDesc": "Enable for models that support thinking/reasoning (e.g. DeepSeek, QwQ). Shows a toggle in chat.",
  "settings.llmModal.temperature": "Temperature",
  "settings.llmModal.temperatureDesc": "Controls randomness (0.0-2.0). Leave empty for server default.",
  "settings.llmModal.maxTokens": "Max tokens",
  "settings.llmModal.maxTokensDesc": "Maximum response tokens. Leave empty for server default.",
  "settings.llmModal.serverDefault": "Server default",

  // Settings - Workspace
  "settings.workspace": "Workspace",
  "settings.workspaceFolder": "Workspace folder",
  "settings.workspaceFolderDesc": "Folder for chat history and RAG data", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- RAG is an acronym
  "settings.saveChatHistory": "Save chat history",
  "settings.saveChatHistoryDesc": "Save chat conversations as markdown files", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- markdown is a proper noun
  "settings.systemPrompt": "System prompt",
  "settings.systemPromptDesc": "Custom instructions for the AI assistant",
  "settings.systemPromptPlaceholder": "e.g. Always respond in Japanese", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- placeholder with example

  // Settings - RAG
  "settings.rag": "Local RAG", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- RAG is an acronym
  "settings.ragDesc": "Retrieval-augmented generation using local embeddings",
  "settings.ragEnable": "Enable RAG", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- RAG is an acronym
  "settings.ragEnableDesc": "Index vault notes and use them as context for chat",
  "settings.ragEmbeddingModel": "Embedding model",
  "settings.ragEmbeddingModelDesc": "Model name for generating embeddings (e.g. nomic-embed-text)", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- model name
  "settings.ragEmbeddingBaseUrl": "Embedding server URL",
  "settings.ragEmbeddingBaseUrlDesc": "Leave empty to use the same server as LLM", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- LLM is an acronym
  "settings.ragTargetFolders": "Target folders",
  "settings.ragTargetFoldersDesc": "Comma-separated folder paths to index (empty = entire vault)",
  "settings.ragExcludePatterns": "Exclude patterns",
  "settings.ragExcludePatternsDesc": "Comma-separated regex patterns to exclude files",
  "settings.ragChunkSize": "Chunk size",
  "settings.ragChunkSizeDesc": "Characters per chunk (default: 1000)",
  "settings.ragChunkOverlap": "Chunk overlap",
  "settings.ragChunkOverlapDesc": "Overlap between chunks (default: 200)",
  "settings.ragTopK": "Top K results", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- Top K is a technical term
  "settings.ragTopKDesc": "Number of chunks to retrieve (default: 5)",
  "settings.ragSync": "Sync now",
  "settings.ragSyncing": "Syncing...",
  "settings.ragSynced": "Synced {{count}} chunks from {{files}} files",
  "settings.ragSyncFailed": "Sync failed: {{error}}",
  "settings.ragClear": "Clear index",
  "settings.ragCleared": "RAG index cleared", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- RAG is an acronym
  "settings.ragStatus": "{{chunks}} chunks from {{files}} files indexed",
  "settings.ragNoIndex": "No index yet. Click sync to build.",

  // Chat
  "chat.welcomeTitle": "Start a conversation with local AI",
  "chat.welcomeHint": "Ask questions, process text, or explore your notes with RAG.", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- RAG is an acronym
  "chat.welcomeThinking": "Enable thinking mode for models that support reasoning",
  "chat.welcomeNewChat": "Click + to start a new chat when changing topics",
  "chat.errorOccurred": "Sorry, an error occurred: {{message}}",
  "chat.unknownError": "Unknown error",
  "chat.generationStopped": "_(generation stopped)_",
  "chat.yesterday": "Yesterday",
  "chat.compacting": "Compacting...",
  "chat.deleteChat": "Delete this chat?",
  "chat.noChats": "No chat history",
  "chat.newChat": "New chat",
  "chat.history": "Chat history",

  // Messages
  "message.you": "You",
  "message.assistant": "Assistant",
  "message.copyToClipboard": "Copy to clipboard",
  "message.thinking": "Thinking",
  "message.tokens": "Tokens",
  "message.thinkingTokens": "Thinking",
  "message.ragUsed": "RAG context used", // eslint-disable-line obsidianmd/ui/sentence-case-locale-module -- RAG is an acronym

  // Input
  "input.placeholder": "Type your message... (Enter to send, Shift+Enter for new line)",
  "input.send": "Send message",
  "input.stop": "Stop generation",
  "input.attach": "Attach file (images, PDF, text)",
  "input.fileTooLarge": "File is too large (max 20MB): {{name}}",
  "input.removeAttachment": "Remove attachment",
  "input.thinkingToggle": "Thinking",
  "input.ragToggle": "RAG",
  "input.selectionVariable": "Selected text in editor",
  "input.contentVariable": "Active note content",
  "input.openFile": "Open file (Ctrl+Shift+O)",

  // Commands
  "command.summarize": "Summarize selection",
  "command.professional": "Make professional",
  "command.actionItems": "Extract action items",
  "command.selectionPrompt": "Send selection to chat",
  "command.customPrompt": "Custom prompt for selection",
  "command.customPromptPlaceholder": "Enter your prompt (selection will be appended)...",
} as const;

export type TranslationKey = keyof typeof en;
