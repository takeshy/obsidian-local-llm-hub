---
type: Product
title: Model setup
description: Local model and embedding model setup guidance.
tags:
  - models
  - setup
  - ollama
  - lm-studio
timestamp: 2026-07-05
---

# Model setup

Local LLM Hub needs a chat model server and, for RAG, an embedding model server.

Common chat backends:

- Ollama with native `/api/chat`.
- LM Studio with OpenAI-compatible `/v1/chat/completions`.
- vLLM with OpenAI-compatible `/v1/chat/completions`.
- AnythingLLM with OpenAI-compatible endpoints.

Common embedding setup:

- Ollama with an embedding model such as `nomic-embed-text`.
- Any OpenAI-compatible embedding endpoint configured in the RAG setting.

If a user uses a cloud chat endpoint through the OpenAI-compatible framework, local RAG still needs a reachable embedding endpoint. A common setup is cloud chat plus local Ollama embeddings.

