import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { findSharedMarkup } from "obsidian-llm-hub-chat-ui/check-markup";

/**
 * Shared chat UI markup lives in obsidian-llm-hub-chat-ui, so the three plugins cannot drift apart.
 * Every class listed here is UI this plugin still renders itself; the list only ever shrinks as
 * components move into the library. Never add an entry to make a new component pass.
 */
const STILL_HOST_RENDERED = [
  "autocomplete",
  "autocomplete-desc",
  "autocomplete-item",
  "autocomplete-name",
  "chat",
  "chat-container",
  "header-btn",
  "input-container",
  "model-dropdown",
  "model-label",
  "model-selector",
  "rag-indicator",
  "rag-source",
  "rag-sources",
  "rag-toggle",
  "rag-used",
  "sidebar-width-btn",
  "skill-name",
  "spin",
  "thinking-content",
  "thinking-summary",
  "tool-clickable",
  "tools-used",
  "usage-info",
  "vault-tool-divider",
  "vault-tool-section-label",
  "wide-sidebar",
  "workflow-error-hint",
];

const sourceDir = fileURLToPath(new URL("../..", import.meta.url));

describe("shared chat UI markup", () => {
  it("is not re-implemented outside the migration allowlist", async () => {
    const findings = await findSharedMarkup({ dir: sourceDir, classPrefix: "llm-hub", allow: STILL_HOST_RENDERED });
    expect(findings.map((finding) => `${finding.className} (${finding.file}:${finding.line})`)).toEqual([]);
  });

  it("has no allowlist entries that are already migrated", async () => {
    const findings = await findSharedMarkup({ dir: sourceDir, classPrefix: "llm-hub" });
    const rendered = new Set(findings.map((finding) => finding.className.replace("llm-hub-", "")));
    expect(STILL_HOST_RENDERED.filter((className) => !rendered.has(className))).toEqual([]);
  });
});
