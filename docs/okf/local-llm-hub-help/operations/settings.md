---
type: Operation
title: Settings
description: Important Local LLM Hub settings and where users configure them.
tags:
  - settings
  - configuration
---

# Settings

Important settings areas:

- Workspace: chat history, system prompt, and workspace folder behavior.
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
