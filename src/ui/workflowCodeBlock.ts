// Render ```workflow code blocks as Mermaid diagrams.
// Uses the mermaid npm package directly (like gemihub) for reliable rendering.
// In Live Preview, Obsidian natively toggles between rendered output (cursor outside)
// and raw YAML source (cursor inside).

import type { App, Plugin } from "obsidian";
import { sidebarNodesToMermaid } from "src/workflow/workflowToMermaid";
import { loadFromCodeBlock } from "src/workflow/codeblockSync";
import { enqueueMermaidRender } from "src/ui/mermaidRender";

function parseAndConvert(yamlSource: string): string | null {
  try {
    const wrapped = "```workflow\n" + yamlSource + "\n```";
    const result = loadFromCodeBlock(wrapped);
    if (!result.data || result.data.nodes.length === 0) return null;
    return sidebarNodesToMermaid(result.data.nodes);
  } catch (e) {
    console.error("Local LLM Hub: Failed to parse workflow for mermaid:", e);
    return null;
  }
}

function isDarkMode(): boolean {
  return document.body.classList.contains("theme-dark");
}

export function registerWorkflowCodeBlockProcessor(plugin: Plugin, _app: App): void {
  plugin.registerMarkdownCodeBlockProcessor("workflow", (source, el) => {
    try {
      const chart = parseAndConvert(source);
      if (!chart) {
        el.textContent = "No workflow nodes";
        return;
      }

      el.addClass("llm-hub-workflow-mermaid");
      el.textContent = "Rendering diagram…";

      let cancelled = false;
      // Clean up on unload to cancel in-flight renders
      const unloadHandler = () => { cancelled = true; };
      // Use MutationObserver to detect removal from DOM
      const observer = new MutationObserver(() => {
        if (!el.isConnected) {
          cancelled = true;
          observer.disconnect();
        }
      });
      observer.observe(el.parentElement || document.body, { childList: true, subtree: true });

      void enqueueMermaidRender(
        { chart, isDark: isDarkMode() },
        () => cancelled,
      ).then((svg) => {
        observer.disconnect();
        if (svg && !cancelled && el.isConnected) {
          el.empty();
          const parser = new DOMParser();
          const doc = parser.parseFromString(svg, "image/svg+xml");
          const svgEl = doc.documentElement;
          if (svgEl && !doc.querySelector("parsererror")) {
            el.appendChild(el.doc.importNode(svgEl, true));
          } else {
            el.textContent = "Failed to render workflow diagram";
          }
        }
      }).catch((e) => {
        observer.disconnect();
        if (!cancelled && el.isConnected) {
          console.error("Local LLM Hub: Failed to render mermaid:", e);
          el.textContent = "Failed to render workflow diagram";
        }
      });

      // Also cancel on plugin unload
      plugin.register(unloadHandler);
    } catch (e) {
      console.error("Local LLM Hub: Failed to render workflow code block:", e);
      el.textContent = "Failed to render workflow diagram";
    }
  });
}
