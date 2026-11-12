# Shared library package

`obsidian-llm-hub-common-0.1.16.tgz` contains prebuilt JavaScript and TypeScript declarations for `npm ci --ignore-scripts`.

Source: [takeshy/obsidian-llm-hub-common commit 3176799](https://github.com/takeshy/obsidian-llm-hub-common/commit/317679917d7984721c50c909e2800bf99a6fb333), version 0.1.16, on branch `feat/hybrid-rag-search`.

Version 0.1.16 adds retrieval-source metadata to fused candidates, shared search-mode
and source badges, and explicit RRF score display. Both hosts use the same UI and
all nine translations. Ordinary vector results retain cosine percentage display;
fused results show `RRF` scores and a Vector / BM25 / Both label. The mode badge
reflects current settings, while existing results retain their retrieval metadata.

Includes the shared tokenizer, incremental BM25 index, chunk cache adapter and RRF
candidate selection from 0.1.15. Hybrid retrieval remains opt-in. Existing cached
text builds BM25 without new document embeddings.

Archive integrity:

```text
sha512-uXRYdbZVP9W8YuVK5/Ri4NmQY2ZZQGrnTpw4jb59ybAtGCI0Uc8+EvLbrkgaVek1+ie4IJrUwOgY7DXJ5Bp14g==
```

Created with `npm pack --ignore-scripts` after the build and full shared-library
test suite passed. The MIT license is included. Previous archives are retained.
