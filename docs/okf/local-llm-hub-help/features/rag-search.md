---
type: Feature
title: RAG Search
description: Dedicated semantic search tab for local RAG indexes.
tags:
  - rag
  - search
  - chunks
timestamp: 2026-07-05
---

# RAG Search

The RAG Search tab lets users query a selected local RAG setting directly. Results are ranked by embedding similarity and can be filtered further with keyword filters.

Important behaviors:

- Top K controls the maximum number of returned chunks.
- Score threshold controls the minimum similarity score.
- Keyword filters narrow already-retrieved results by text or path.
- Selected results can be sent to Chat as attachments.
- Chunk editor can edit result text and load adjacent chunks with overlap removal.
- AI keyword suggestion expands filter terms using the configured local model.
- AI refine can load surrounding chunks, evaluate whether more context is needed, and clean the combined text while preserving meaning.

RAG Search is useful when the user wants to inspect sources before using them in chat.

Indexed content includes Markdown and PDFs with extractable text. PDF results show a PDF badge and page range. If a PDF cannot be extracted during sync, existing indexed chunks are preserved instead of being silently removed.

Keyword filter details:

- Terms inside one filter field use OR logic.
- Multiple filter fields use AND logic.
- Matching checks chunk text and file path.
- Whitespace is normalized so PDF extraction artifacts and CJK spacing do not easily break matches.

Chat RAG and RAG Search differ: the chat RAG dropdown injects automatic system context using the RAG setting defaults, while RAG Search lets the user inspect, filter, edit, refine, and manually select chunks before sending them to chat as attachments.
