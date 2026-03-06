# Local LLM Hub

Chat with local LLMs (Ollama, LM Studio) with local embeddings RAG, file encryption, edit history, slash commands, and workflow automation.

## Requirements

- [Ollama](https://ollama.com/) or [LM Studio](https://lmstudio.ai/)
- A chat model (e.g. `ollama pull qwen3.5:4b`)
- **For RAG**: An embedding model is required (e.g. `ollama pull nomic-embed-text`)

## Setup

1. Install and start your LLM server
2. Open plugin settings and select your framework (Ollama / LM Studio)
3. Set the server URL (defaults are pre-filled per framework)
4. Fetch and select your chat model
5. Click "Verify connection"

### RAG Setup

RAG (Retrieval-Augmented Generation) indexes your vault notes and uses them as context for chat. An embedding model is required.

**Ollama:**
```
ollama pull nomic-embed-text
```

**LM Studio:**
Download an embedding model (e.g. nomic-embed-text) in LM Studio and load it. All loaded models will appear in the embedding model dropdown.

Then:
1. Enable RAG in settings
2. Fetch and select the embedding model
3. Configure target folders (optional, defaults to entire vault)
4. Click "Sync" to build the index

## Features

- **Chat** with local LLMs with streaming responses and thinking display
- **RAG** with local embeddings for context-aware answers from your notes
- **File encryption** for sensitive notes
- **Edit history** with automatic tracking of file changes
- **Slash commands** for custom prompt templates
- **Workflow automation** with node-based execution engine, AI generation, event triggers, and hotkeys

## Supported Frameworks

| Framework | Chat Endpoint | Streaming | Thinking |
|-----------|--------------|-----------|----------|
| Ollama | `/api/chat` (native) | Real-time | `message.thinking` field |
| LM Studio | `/v1/chat/completions` | SSE | `<think>` tags |
