---
type: Feature
title: OKF knowledge sources
description: Markdown knowledge bundles available to chat.
tags:
  - okf
  - knowledge
timestamp: 2026-07-05
---

# OKF knowledge sources

OKF is a Markdown-based knowledge bundle format. Local LLM Hub can discover bundles under the configured OKF directory and add selected bundles as compact system prompt context.

Use OKF for curated reference knowledge that should be available in chat without building a RAG index. Use RAG for semantic retrieval over larger vault content. They can be used together.

Typical setup:

1. Put bundles under a vault-relative folder such as `Knowledge` or `.Knowledge`.
2. Enable OKF in Settings -> Knowledge sources.
3. Select one or more discovered bundles in the chat input area.

Bundle files are Markdown with YAML frontmatter such as `type`, `title`, `description`, and `tags`. `index.md` acts as an entry point. `log.md` is skipped.

