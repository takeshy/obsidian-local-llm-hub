---
type: Feature
title: Chat
description: Chat with configured local or OpenAI-compatible models inside Obsidian.
tags:
  - chat
  - local-models
---

# Chat

The Chat view sends the conversation to the selected configured model. Local LLM Hub supports Ollama through its native `/api/chat` endpoint and also supports OpenAI-compatible chat endpoints such as LM Studio, vLLM, AnythingLLM, and other compatible servers.

Chat can include context from the vault through RAG and from enabled OKF bundles. If RAG is selected, semantic search results are injected into the prompt. If OKF bundles are enabled in the input area, their curated Markdown summaries are added as domain context.

Users should start a new chat when switching topics if they do not want prior conversation history included.
