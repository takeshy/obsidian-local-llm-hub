---
type: Feature
title: Vault tools
description: Function-calling tools for reading, writing, searching, and editing the vault.
tags:
  - vault
  - tools
  - function-calling
---

# Vault tools

Vault tools let compatible models operate on Obsidian files. Tools include reading notes, creating notes and folders, searching notes, listing notes and folders, getting active note info, and proposing edits, deletes, or renames.

Vault tool modes:

- All: full vault tool access.
- No Search: disables search/list style tools while keeping direct read/write operations.
- Off: disables vault tools.

Ollama native chat and other marker-only local model modes may not support OpenAI-style function calling. In those cases users should rely on workflows for deterministic vault operations.

