---
type: Feature
title: Agent skills
description: Reusable SKILL.md instructions and optional workflow tools.
tags:
  - skills
  - workflows
  - chat
timestamp: 2026-07-05
---

# Agent skills

Agent skills are `SKILL.md` files that add reusable instructions to chat. Users enable skills per conversation from the chat input area.

Built-in Obsidian Markdown, Canvas, and Bases skills are available without vault setup. When the separate Dashboard Hub plugin is enabled, it contributes a `dashboard` skill at runtime for authoring `.dashboard` files and backing `.base` files.

Skills are stored under the configured workspace skills folder, commonly `LocalLlmHub/skills`. A skill is a folder containing `SKILL.md`; optional `references/` files are appended to the skill context.

`SKILL.md` frontmatter can include:

- `name`: display name. Defaults to folder name.
- `description`: short text shown in the selector.
- `workflows`: optional workflow declarations, each with `path` and optional `description`.

Skills can also expose workflows. When a skill workflow is available, the model can call it as a tool during chat. If a skill workflow fails, the UI can open the workflow file and switch to the Workflow / skill tab so the user can inspect execution history and repair the workflow.

Workflow files can be declared in frontmatter or auto-discovered under a `workflows/` folder. When `run_skill_workflow` is called, every workflow variable whose name does not start with `__` is returned to the chat model as tool output.

Users can create skills with AI from the Workflow / skill tab. When editing an existing `SKILL.md`, Modify skill with AI updates the instruction body and referenced workflow together while preserving frontmatter.
