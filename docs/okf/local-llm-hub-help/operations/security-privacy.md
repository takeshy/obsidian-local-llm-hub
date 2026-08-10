---
type: Operation
title: Security and privacy
description: Local-first privacy model and sensitive data handling.
tags:
  - security
  - privacy
  - local
timestamp: 2026-07-05
---

# Security and privacy

Local LLM Hub is designed around local processing. Chat history is stored in vault files, RAG vectors are stored locally, MCP servers run as local child processes, and encrypted files are decrypted locally only after password entry.

Data owned by integrated plugins such as Dashboard Hub is covered by those plugins' documentation.

Important caveat: if the user configures a remote OpenAI-compatible endpoint, prompts and selected context are sent to that endpoint. Users should choose local endpoints when policy requires data to stay on the machine.

Encrypted files are hidden from AI chat tools. Workflows can access encrypted files only through password prompts.

LLM vault tool access can be limited in Settings -> Workspace -> LLM vault tool folders. Non-empty values restrict chat vault tools, LLM tools used inside workflows, and LLM-triggered skill workflows to the listed vault-relative folders. Empty means whole-vault access.

This allowlist does not restrict RAG retrieval, manual attachments, explicit `@note` mentions, MCP tools, sandboxed scripts, or workflows started directly by the user. It is an application-level boundary for LLM-driven vault operations, not an operating-system permission boundary for the Obsidian plugin itself.

Agent Plugins are downloaded from a user-selected public GitHub repository and pinned to the commit shown during preview. Packages reject unsafe paths, symlinks, excessive file counts or sizes, reserved environment variables, working directories outside the plugin root/data directories, and absolute plugin executables outside the package root. Users should still review the repository and preview because an enabled plugin MCP server executes a local child process with the current user's operating-system permissions.
