---
type: Feature
title: Workflows
description: Reusable YAML workflows that can run model prompts and vault actions.
tags:
  - workflows
  - automation
timestamp: 2026-07-05
---

# Workflows

Workflows are reusable YAML automation definitions stored in the vault. They can run model prompts, read and write notes, prompt for input, call HTTP endpoints, branch, loop, and compose other workflow steps.

Dashboard workflow widgets can display workflow output when the workflow saves a Markdown or HTML result variable.

Workflows should use configured local or OpenAI-compatible models unless the user has explicitly configured another endpoint.

