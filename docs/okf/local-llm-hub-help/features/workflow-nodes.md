---
type: Reference
title: Workflow nodes
description: Workflow node categories and common node behavior.
tags:
  - workflows
  - nodes
  - reference
timestamp: 2026-07-05
---

# Workflow nodes

Workflows are YAML documents made of ordered nodes. Users can usually ask AI to create or modify workflows, but these node properties are the stable reference when editing YAML directly.

Top-level options:

- `name`: workflow display name.
- `options.showProgress`: `true` by default. Set `false` to hide the execution progress modal when launched from hotkey or workflow list.
- `nodes`: list of node records. Each node needs `id` and `type`. Most nodes can use `next` to jump to another node.

Variable interpolation uses `{{name}}` inside string fields.

## MCP approval and Vault access

The `command` node accepts `confirm: "false"` to skip MCP approval, including automatic execution. Otherwise each server's approval settings apply. `vaultTools` accepts `noSearch` (default), `all`, `readOnly`, or `none`. Read-only mode allows Vault search and reading without file changes; external MCP and skill tools have separate permissions. `enableTools: "false"` disables all tools for the node. These settings do not change the `note` node's own confirmation behavior.

## Core nodes

- `command`: sends `prompt` to the configured local or OpenAI-compatible chat model and stores the text response in `saveTo`. It can use `attachments` from `file-explorer` data. Use this for LLM reasoning, summaries, rewrites, extraction, and generated Markdown or HTML.
- `variable`: declares a value. Common fields are `name` and `value`.
- `set`: updates a variable. Common fields are `name` and `value`.
- `if`: branches on a condition. It uses condition fields plus branch targets such as `then` and `else`.
- `while`: repeats nodes while a condition remains true. Use explicit counters or limits to avoid accidental infinite loops.
- `sleep`: pauses execution for a configured duration.

## Vault and note nodes

- `note`: writes `content` to `path`. `mode` can be `overwrite`, `append`, or `create`. `confirm` controls whether the user is asked before writing. `history` controls whether edit history is recorded.
- `note-read`: reads a note from `path` into `saveTo`. Encrypted files prompt for the password if it is not cached in the current Obsidian session.
- `note-search`: searches note names, and optionally contents, using `query`, `searchContent`, `limit`, and `saveTo`.
- `note-list`: lists notes using filters such as `folder`, `recursive`, `tags`, `tagMatch`, `createdWithin`, `modifiedWithin`, `sortBy`, `sortOrder`, `limit`, and `saveTo`.
- `folder-list`: lists folders under `folder` and stores `{ folders, count }` in `saveTo`.
- `open`: opens a vault file at `path`. Markdown extension is added when omitted.

Use these deterministic nodes when the workflow must reliably read or write vault files, especially with local models that cannot call chat tools.

## File, prompt, and UI nodes

- `file-explorer`: opens a file picker for vault files or attachments and stores selected file data for later nodes.
- `file-save`: writes binary or text file data returned by another node.
- `prompt-file`: asks the user to pick a file.
- `prompt-selection`: asks the user for a text selection or selection-derived input.
- `dialog`: shows a title, message, optional Markdown rendering, and buttons. Use it for final confirmations or user-visible results.

Workflows invoked through integrations such as Dashboard Hub should avoid interactive nodes such as `prompt-*` and `dialog`, because they run headlessly.

## Data and integration nodes

- `http`: sends an HTTP request. Typical fields include `url`, `method`, `headers`, request body fields, and `saveTo`.
- `json`: parses, extracts, or transforms JSON from variables.
- `script`: runs sandboxed JavaScript in an iframe. Prefer built-in nodes for vault operations; use script for transformations that are awkward in YAML.
- `obsidian-command`: runs an Obsidian command by command id.
- `workflow`: calls another workflow as a sub-workflow and can pass variables through.
- `rag-sync`: compatibility node for syncing notes to the RAG store.

## Output conventions

Nodes that produce data usually write to `saveTo`. Skill workflows return every variable whose name does not start with `__` to chat tool results, so prefix private intermediate values with `__`.
