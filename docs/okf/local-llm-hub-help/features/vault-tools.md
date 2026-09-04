---
type: Feature
title: Vault tools
description: Function-calling tools for reading, writing, searching, and editing the vault.
tags:
  - vault
  - tools
  - function-calling
timestamp: 2026-07-05
---

# Vault tools

Vault tools let compatible models operate on Obsidian files. Tools include reading notes, creating notes and folders, searching notes, listing notes and folders, getting active note info, and proposing edits, deletes, or renames.

Vault tool modes:

- All: full vault tool access.
- No Search: disables search/list style tools while keeping direct read/write operations.
- Read only: allows search and reading but blocks built-in tools that create, edit, delete, or rename files and folders. MCP and skill tools retain their own permissions.
- Off: disables vault tools.

## Folder access

Settings -> Workspace -> LLM vault tool folders restricts LLM vault tools and LLM-triggered skill workflows to specified vault-relative folders. Empty means whole-vault access. This setting is independent of RAG index folders.

The folder allowlist does not restrict RAG, manual attachments, explicit `@note` mentions, MCP tools, scripts, shell commands, or workflows started directly by the user.

Ollama native chat and other marker-only local model modes may not support OpenAI-style function calling. In those cases users should rely on workflows for deterministic vault operations.
