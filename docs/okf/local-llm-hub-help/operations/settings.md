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
- Local LLM: framework selection, endpoint URL, API key if needed, available models, thinking display, and tool support.
- RAG: embedding endpoint/model, folders, exclusions, chunking, top K, and score threshold.
- MCP: configured MCP servers for tools when enabled by the plugin.
- Knowledge sources: OKF directory settings.

Supported Local LLM framework modes:

- Ollama: native `/api/chat`.
- LM Studio: OpenAI-compatible `/v1/chat/completions`.
- vLLM: OpenAI-compatible `/v1/chat/completions`.
- AnythingLLM: OpenAI-compatible endpoint mode.

For OKF, enable the OKF source and set a vault-relative directory such as `Knowledge` or `.Knowledge`. The chat input can then select discovered OKF bundles from that directory.

`LLM vault tool folders` is a comma-separated, vault-relative allowlist for automatic LLM vault tool access. Empty means the whole vault. This setting is separate from RAG index folders.
