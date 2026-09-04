---
type: Feature
title: Chat
description: Chat with configured local or OpenAI-compatible models inside Obsidian.
tags:
  - chat
  - local-models
timestamp: 2026-07-05
---

# Chat

The Chat view sends the conversation to the selected configured model. Local LLM Hub supports Ollama through its native `/api/chat` endpoint and also supports OpenAI-compatible chat endpoints such as LM Studio, vLLM, AnythingLLM, and other compatible servers.

Chat can include context from the vault through RAG and from enabled OKF bundles. If RAG is selected, semantic search results are injected into the prompt. If OKF bundles are enabled in the input area, their curated Markdown summaries are added as domain context.

Users should start a new chat when switching topics if they do not want prior conversation history included.

The expand/shrink control toggles a desktop sidebar between normal and expanded widths. Save as note exports a non-empty conversation as compact Markdown named `YYYYMMDD-HHmmss_Chat title.md`, without history frontmatter or restoration metadata. Saving the same chat again during the session overwrites the export. Chat settings control its vault-relative destination; blank uses the vault root.

Automatic history is separate. Its maximum saved chat setting removes oldest histories above the limit; zero is unlimited. Existing installations default to unlimited, while new installations default to 100.

## MCP approval and read-only tools

The Vault tool menu and slash commands support read-only mode for search and reading without file changes. MCP calls require approval unless the server has Always approve enabled or the tool is in its allowed list. The dialog shows the server, tool, and arguments and offers Allow once, Always allow this tool, or Deny. Closing it denies the call. Remove an allowed tool in MCP server settings and save to require approval again.
