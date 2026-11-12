# Shared library package

`obsidian-llm-hub-common-0.1.15.tgz` contains prebuilt JavaScript and TypeScript declarations for `npm ci --ignore-scripts`.

Source: [takeshy/obsidian-llm-hub-common commit 5d1ee69](https://github.com/takeshy/obsidian-llm-hub-common/commit/5d1ee69307400ffbd0ffad0986e6807e394fbf4a), version 0.1.15, on branch `feat/hybrid-rag-search`.

Version 0.1.15 adds the shared tokenizer, incremental BM25 index, chunk cache adapter,
and reciprocal rank fusion candidate selection. The shared settings UI adds an
opt-in hybrid toggle and per-channel candidate count, translated into all nine
locales. The default remains vector-only retrieval. Existing cached text builds
BM25 without new document embeddings; hosts persist `bm25.json` for internal
indexes and construct combined/external keyword indexes in memory.

Archive integrity:

```text
sha512-q1qHEQsOh9biUDEFwC7MmdHqZ9VZ0ChB9vek9D2RkJtMxubWbXAraDtNFdGHAG3cIgrEvabeXUHQ/HNfr75MCQ==
```

Created with `npm pack --ignore-scripts` after the build and the full shared-library
test suite passed. The MIT license is included. Previous archives are retained for history.
