---
type: Operation
title: Settings
description: Important Local LLM Hub settings and where users configure them.
tags:
  - settings
  - configuration
timestamp: 2026-07-05
---

# Settings

Important settings areas:

- Workspace: chat history, system prompt, workspace folder behavior, and the folders LLM vault tools may access.
- Chat: vault-relative destination for compact notes created by Save as note.
- Local LLM: framework selection, endpoint URL, API key if needed, available models, thinking display, and tool support.
- RAG: embedding endpoint/model, folders, exclusions, chunking, top K, and score threshold.
- MCP: configured MCP servers for tools when enabled by the plugin.
- Agent plugins: commit-pinned Agent Plugins v1.0.0 installed from public GitHub repositories.
- Knowledge sources: OKF directory settings.

Supported Local LLM framework modes:

- Ollama: native `/api/chat`.
- LM Studio: OpenAI-compatible `/v1/chat/completions`.
- vLLM: OpenAI-compatible `/v1/chat/completions`.
- AnythingLLM: OpenAI-compatible endpoint mode.

For Ollama embeddings, configure the server root URL as `http://localhost:11434`. Do not append `/v1`; Local LLM Hub adds the required API paths automatically. A trailing slash is optional.

For OKF, enable the OKF source and set a vault-relative directory such as `Knowledge` or `.Knowledge`. The chat input can then select discovered OKF bundles from that directory.

`LLM vault tool folders` is a comma-separated, vault-relative allowlist for automatic LLM vault tool access. Empty means the whole vault. This setting is separate from RAG index folders.

Automatic chat history supports a maximum saved chat count. Zero is unlimited; existing installations default to zero and new installations to 100. Manual exports use `YYYYMMDD-HHmmss_Chat title.md`, omit history metadata, and overwrite the same chat's note during the session.

# Agent plugin settings

- GitHub repository accepts `owner/repository` or a public GitHub URL.
- Preview and install validates the manifest, paths, symlinks, file counts and sizes, then displays the pinned commit, skills, MCP servers, and warnings.
- Plugin MCP servers are tested before installation completes. Failed servers remain unavailable for automatic skill activation.
- Enable or disable controls skill discovery and automatic MCP activation for the package.
- Check for update compares the installed commit with the latest release, falling back to the repository's default branch.
- Uninstall removes package files and managed MCP settings but preserves `.local-llm-hub/agent-plugin-data/<plugin-name>/`.
