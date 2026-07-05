---
type: Reference
title: Dashboard schema
description: `.dashboard` YAML structure.
tags:
  - dashboard
  - schema
  - yaml
---

# Dashboard schema

Dashboards are YAML files with `.dashboard` extension.

Core fields:

- `version`: dashboard schema version.
- `grid`: grid settings with `cols`, `rowHeight`, and `gap`.
- `widgets`: widget records.

Each widget has:

- `id`: stable widget id.
- `type`: widget type such as `base`, `markdown`, `file`, `web`, `workflow`, `kanban`, `timeline`, or `memo-list`.
- `layout`: breakpoint layout positions, commonly `lg` and optional `sm`.
- `config`: widget-specific configuration.

Layout positions use `x`, `y`, `w`, and `h`. `lg` is the wide layout. `sm` is the narrow single-column layout and can be derived automatically from `lg` when omitted.

Common widget config fields:

- `base`: `basePath`, `view`, optional header settings.
- `markdown`: `path`.
- `file`: `path`, `showHeader`, `memoPanelOpen`, `memoPanelCollapsed`.
- `web`: `url`, `showHeader`.
- `workflow`: workflow path, output format, output variable, auto-refresh interval, and cache metadata.
- `kanban`: title, tag/folder filters, status property, title property, columns, display fields, unmatched-column behavior, and manual `cardOrder`.
- `timeline`: timeline name, initial post count, collapse line threshold, and collapse character threshold.
- `memo-list`: source filter and pagination settings for files that have dashboard reading memos.

Unknown widget keys are preserved during parse and serialize.
