# Local LLM Hub

Chat with local LLMs (Ollama, LM Studio) with vault tools via function calling, local embeddings RAG, file encryption, edit history, slash commands, and workflow automation.

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

### AI Chat

- **Streaming responses** with real-time display
- **Thinking display** for models that support it
- **File attachments** (images, PDFs, audio, video)
- **@ mentions** to reference vault notes as context
- **Multiple chat sessions** with conversation history

### Vault Tools (Function Calling)

Models that support function calling (e.g., Qwen, Llama 3.1+, Mistral) can directly interact with your vault through 10 built-in tools:

| Tool | Description |
|------|-------------|
| `read_note` | Read content from a note |
| `create_note` | Create a new note |
| `update_note` | Update an existing note (replace/append/prepend) |
| `rename_note` | Rename or move a note |
| `create_folder` | Create a new folder |
| `search_notes` | Search notes by content |
| `list_notes` | List notes in a folder |
| `list_folders` | List folders in the vault |
| `get_active_note` | Get the currently active note |
| `propose_edit` | Propose an edit to the user |

**Vault Tool Modes:**

Click the database icon in the chat input area to select a mode:

| Mode | Description |
|------|-------------|
| **All** | All 10 vault tools enabled |
| **No Search** | All tools except `search_notes` and `list_notes` |
| **Off** | No vault tools (text-only chat) |

**Fallback:** If a model doesn't support function calling, the plugin automatically switches to "Off" mode and shows a notification. You can continue chatting without tools.

### Compact History

Use the `/compact` slash command (available when there are 2+ messages) to compress your conversation history. The LLM summarizes the conversation, and a new chat session is created with the summary as context. This helps manage long conversations without losing important context.

### Slash Commands

Create custom prompt templates in settings. Type `/` in the chat input to see available commands.

Each slash command can optionally override the vault tool mode, so you can create commands that always run with specific tool access regardless of the current setting.

### RAG (Retrieval-Augmented Generation)

When RAG is enabled and synced, relevant vault notes are automatically included as context for your chat messages.

### File Encryption

Encrypt sensitive notes using the command palette. Encrypted files are stored securely and can be decrypted on demand.

### Edit History

Automatic tracking of file changes with the ability to view and restore previous versions.

### Workflow Automation

Node-based workflow engine for automating tasks. Features include:

- **22 node types** for variables, control flow, LLM prompts, HTTP requests, note operations, user dialogs, and more
- **AI generation** - describe what you want and the AI creates the workflow
- **Event triggers** - automatically run workflows on file create/modify/delete/rename/open
- **Hotkey support** - assign keyboard shortcuts to any named workflow
- **Sub-workflows** - compose complex workflows from reusable parts
- **Execution history** - review past workflow runs with step-by-step details

See [docs/WORKFLOW_NODES.md](docs/WORKFLOW_NODES.md) for the complete node reference.

## Supported Frameworks

| Framework | Chat Endpoint | Streaming | Thinking | Function Calling |
|-----------|--------------|-----------|----------|-----------------|
| Ollama | `/api/chat` (native) | Real-time | `message.thinking` field | `tools` parameter |
| LM Studio | `/v1/chat/completions` | SSE | `<think>` tags | `tools` parameter |

## Privacy

All data stays local:

- **Chat history** - stored in `.obsidian/plugins/local-llm-hub/`
- **RAG index** - stored locally in the plugin directory
- **Encrypted files** - encrypted/decrypted locally
- **Edit history** - stored locally in the plugin directory
- **LLM requests** - sent only to your local Ollama or LM Studio server
