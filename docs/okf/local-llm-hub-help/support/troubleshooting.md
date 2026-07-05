---
type: Support
title: Troubleshooting
description: Common Local LLM Hub troubleshooting checks.
tags:
  - troubleshooting
  - support
---

# Troubleshooting

Common checks:

- If chat fails, verify the model server is running and the configured base URL is reachable.
- If model list fetch fails, check the framework selection and endpoint path.
- If RAG returns no results, sync the selected RAG setting and verify target folders and exclusions.
- If PDF files produce zero chunks, PDF text extraction may have failed; modify or rename the PDF or rebuild the index to retry.
- If vault tools fail, verify the selected model supports function calling. Use workflow note nodes as a fallback.
- If OKF bundles do not appear, verify Settings -> Knowledge sources points at the parent OKF folder and the bundle contains Markdown files.

