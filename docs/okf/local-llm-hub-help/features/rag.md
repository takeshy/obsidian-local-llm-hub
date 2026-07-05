---
type: Feature
title: Local RAG
description: Local semantic search over vault files using configured embedding models.
tags:
  - rag
  - embeddings
  - search
timestamp: 2026-07-05
---

# Local RAG

Local LLM Hub can build local RAG indexes for vault content. A RAG setting defines the embedding endpoint, embedding model, target folders, exclusions, chunking, and retrieval parameters.

RAG is local-first: indexed chunks and vectors are stored locally, and chat can use a selected RAG setting to retrieve relevant vault context. Users can create multiple RAG settings for different folders or embedding models.

Use RAG for source-grounded answers over vault notes and documents. Use OKF for curated product or domain knowledge that should always be summarized into the prompt when selected.

