# Shared library package

`obsidian-llm-hub-common-0.1.10.tgz` contains prebuilt JavaScript and TypeScript declarations for `npm ci --ignore-scripts`.

Source: the local `obsidian-llm-hub-common` working tree based on commit `e0e7f4072930d2ffd91803f61b92fd3a3d03bb4a`, with uncommitted user-message link and icon-button styling fixes in `styles.css` and `src/index.tsx` and the 0.1.10 version update. The archive also includes pre-existing local README edits. These changes have not been committed or published to npm.

The shared file-reference resolver handles wikilinks, @ references, and vault paths. Chat messages preserve the original references. Only model requests annotate each tool-readable reference with path, type, and byte size; file contents are fetched on demand and reading instructions stay in the system prompt. Hosts retain their inline fallback policy, vault tool scope, PDF reader, and character limit.

Archive integrity:

```text
sha512-UQAb7NT8ItzLICojvOG2lblSDwP07EKcPxRq1RlRlq2VslCkUucjyGXdStJD7zHFCBVILHprEYvTxSlZnk9NjA==
```

Created with `npm pack`, whose prepack script runs the build and full tests. The MIT license is included.

## Workflow generation fix

The plugin uses `obsidian-llm-hub-common-0.1.10-workflow-generation-fix.tgz`,
which preserves the original 0.1.10 archive except for `styles.css`,
`dist/ui/workflow/WorkflowGenerationModal.js` and `dist/ui/workflow/AIWorkflowModal.js`. The source changes are recorded
in [workflow-generation.patch](workflow-generation.patch), based on shared
source commit `4e5edc1`. Apply the patch to that source and run `npm run build`
to reproduce the three updated files.

The fix keeps the generation title, request, phases and status visible and
restores the Cancel button and loading dots after plan approval. Generation
errors remain visible in the modal until it is closed. Review content uses
an automatic flex basis so it expands in auto-height modals instead of
collapsing to one line; long reviews scroll within half the viewport height.
No other shared-library changes are included. The sibling checkout is untouched.

Patched archive integrity:

```text
sha512-AGqxc2oXwAHFlF7WQ1y3YW0m1aGUvm3HhtS6lj5J6I5opwvXVCnBXyEUYPPwcw9ihM7oTQ8nXruawlvcLhDajQ==
```
