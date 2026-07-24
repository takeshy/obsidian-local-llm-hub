---
type: Product
title: Local LLM Hub overview
description: Local-first Obsidian AI assistant overview.
tags:
  - local-llm-hub
  - overview
timestamp: 2026-07-05
---

# Local LLM Hub overview

Local LLM Hub is the local-first variant of the LLM Hub / Gemini Helper workflow experience. It focuses on Obsidian automation where vault contents, chat history, RAG indexes, MCP processes, encryption, and edit history stay on the user's machine.

Primary capabilities:

- Chat with local or OpenAI-compatible models.
- Use vault tools from models that support function calling.
- Build and run YAML workflows from the Workflow / skill tab.
- Create and activate agent skills from `SKILL.md` files.
- Build local embedding RAG indexes and search them.
- Integrate configured models, Chat, Base generation, text rewriting, and Workflow generation/execution with the separate Dashboard Hub plugin.
- Encrypt sensitive files and keep AI tools away from encrypted contents.

Cloud APIs can be used only when the user deliberately configures an OpenAI-compatible remote endpoint. The default product positioning is local LLMs such as Ollama, LM Studio, vLLM, or AnythingLLM.
