# Shared library package

The plugin uses `obsidian-llm-hub-common-0.1.14.tgz`, which contains prebuilt
JavaScript and TypeScript declarations for `npm ci --ignore-scripts`. It is the
only archive kept here; older ones are in the Git history.

Source: sibling `obsidian-llm-hub-common` commit
`1727cce954654b6ee2579abc1103915a6e8f6f8c` (0.1.14). Run `npm run build` there to reproduce the package contents.

Changes in 0.1.14 relative to 0.1.13:

- The `rag-sync` node editor takes the RAG setting as text with the host's
  setting names as suggestions, so `{{variable}}` expressions can be shown,
  typed and kept.
- `runRagSyncNode` may return the setting it actually used. Logs and history
  record that name instead of an empty one when the host falls back to the
  selected setting.
- The generation modal shows exactly one group of loading dots.
- A generation error replaces Cancel with Close, and an error raised after the
  modal has closed no longer writes into it.

Build and the full shared-library test suite passed before packaging. The archive
was then created with `npm pack --ignore-scripts` from that validated build.

Archive integrity:

```text
sha512-Qr/V5tGdXj+QjVEXoIRrtwyKpvKhnakgbTH9VUp2aTWl1i06TaUNEuViVYW1mTRHiEKfDHBTavkbiVIBUI5/fg==
```
