---
type: Feature
title: Dashboard widgets
description: Built-in widget types available in dashboard files.
tags:
  - dashboard
  - widgets
  - memos
timestamp: 2026-07-05
---

# Dashboard widgets

Built-in dashboard widgets include:

- Base: embeds a `.base` file view.
- File: displays Markdown, text/code, HTML, images, PDF, and EPUB files.
- Web Embed: embeds a web page in an iframe.
- Workflow: runs or displays workflow output.
- Kanban: groups notes by a frontmatter status property and can share its definition through a `.kanban` file under `Dashboards/Kanbans`.
- Secret Manager: creates, searches, decrypts, and copies `.encrypted` vault secrets from an optional folder.
- Timeline: stores short dated posts under the dashboard data folders.
- MemoList: lists files that have dashboard reading memos.

The dashboard title opens a switcher for other `.dashboard` files in the vault.
Legacy Markdown widgets are migrated to File widgets when their dashboard is loaded.

Kanban widgets support temporary tag filtering, reusable board definitions, and configurable frontmatter or explicit `file.*` display fields. Secret Manager uses the plugin encryption settings; descriptions and public metadata are searchable, while secret values are decrypted only for editing or copying and are never stored as plaintext.

The File widget can keep memos beside a source document. Memos are stored as Markdown files under `Dashboards/Memos`, with frontmatter pointing back to the source file. For rendered text, PDF, and EPUB content, selected text can be attached as a quote so the memo remains tied to the reading context.

File widget support:

- Markdown: rendered with Obsidian Markdown rendering.
- Text/code: `txt`, `json`, `csv`, `tsv`, `js`, `ts`, `tsx`, `jsx`, `css`, `xml`, `yaml`, and `yml`.
- HTML: rendered in a sandboxed iframe.
- Images: `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, and `bmp`.
- PDF: rendered with selectable text and quote anchoring.
- EPUB: parsed from the EPUB package and rendered as HTML chapters.

Memo behavior:

- The memo panel can be opened, collapsed, or closed per File widget.
- A selected quote can be copied, sent to chat, or added to a memo.
- Memo records include text, optional quote, optional quote anchor, and quote prefix/suffix context.
- The memo header Ask AI action sends the memo file path and source file path to chat.
- MemoList surfaces files that already have reading memos so users can revisit annotated documents.
