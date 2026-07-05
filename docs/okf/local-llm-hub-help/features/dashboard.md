---
type: Feature
title: Dashboard
description: Editable dashboard files that arrange live widgets in a responsive grid.
tags:
  - dashboard
  - widgets
---

# Dashboard

Dashboards are `.dashboard` files stored in the vault. They render a responsive grid of live widgets and can be edited inside Obsidian.

Create a dashboard with the `LLM Hub: Create dashboard` command, or enable the built-in `dashboard` agent skill in chat and describe the workspace you want. AI-created dashboards can also create backing `.base` files and workflow files.

Dashboards open in view mode. Use the toolbar to enter edit mode, add widgets, drag widgets, resize widgets, configure widget settings, delete widgets, and use undo or redo for layout changes. Edits save automatically to the `.dashboard` YAML file.

Dashboard content is live where possible:

- Base widgets embed native Obsidian Bases views.
- Markdown and File widgets render vault files.
- Web widgets embed external pages that allow iframe embedding.
- Workflow widgets render cached Markdown or HTML output from `Dashboards/Data`.
- Kanban widgets update note frontmatter when cards move.
- Timeline widgets store dated posts under `Dashboards/Timeline`.
- File widgets can store reading memos under `Dashboards/Memos`.

Workflow widgets are cached by design. They run only when the user clicks Run, when auto-refresh decides the cached output is stale, or while the dashboard stays open past the refresh interval. The workflow must write a Markdown or HTML string to the configured output variable and should not use interactive nodes.
