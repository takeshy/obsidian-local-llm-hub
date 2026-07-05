---
type: Operation
title: Security and privacy
description: Local-first privacy model and sensitive data handling.
tags:
  - security
  - privacy
  - local
---

# Security and privacy

Local LLM Hub is designed around local processing. Chat history is stored in vault files, RAG vectors are stored locally, MCP servers run as local child processes, and encrypted files are decrypted locally only after password entry.

Important caveat: if the user configures a remote OpenAI-compatible endpoint, prompts and selected context are sent to that endpoint. Users should choose local endpoints when policy requires data to stay on the machine.

Encrypted files are hidden from AI chat tools. Workflows can access encrypted files only through password prompts.

