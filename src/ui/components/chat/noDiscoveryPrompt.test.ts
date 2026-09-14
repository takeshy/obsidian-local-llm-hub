import { describe, expect, it } from "vitest";
import { buildNoDiscoverySystemPrompt } from "./noDiscoveryPrompt";

describe("buildNoDiscoverySystemPrompt", () => {
  it("prioritizes retrieved RAG context", () => {
    const prompt = buildNoDiscoverySystemPrompt({ ragRequested: true, hasRagContext: true });
    expect(prompt).toContain("RAG retrieved relevant vault context");
    expect(prompt).toContain("primary vault source");
    expect(prompt).toContain("Do not guess note paths");
  });

  it("requests on-demand retrieval without claiming an unsearched index returned no results", () => {
    const prompt = buildNoDiscoverySystemPrompt({ ragRequested: true, hasRagContext: false });
    expect(prompt).toContain("No RAG context has been supplied yet");
    expect(prompt).toContain("use rag_search if available before concluding");
    expect(prompt).not.toContain("returned no relevant vault context");
    expect(prompt).toContain("shown in a retrieved source citation");
    expect(prompt).toContain("Do not fill the gap with assumptions");
  });

  it.each([
    { ragRequested: true, hasRagContext: true },
    { ragRequested: true, hasRagContext: false },
    { ragRequested: false, hasRagContext: false },
  ])("does not require broader vault permissions for missing context: %j", (options) => {
    const prompt = buildNoDiscoverySystemPrompt(options);
    expect(prompt).not.toContain("Vault: all");
    expect(prompt).toContain("reference or attach the relevant note");
    expect(prompt).toContain("Do not guess note paths");
  });

  it("directs current-note questions to the active note when RAG is off", () => {
    const prompt = buildNoDiscoverySystemPrompt({ ragRequested: false, hasRagContext: false });
    expect(prompt).toContain("RAG is not active");
    expect(prompt).toContain("current note as the primary vault source");
    expect(prompt).toContain("exact path explicitly supplied by the user");
  });
});
