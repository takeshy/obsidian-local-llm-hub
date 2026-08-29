import { describe, expect, it } from "vitest";
import { buildNoDiscoverySystemPrompt } from "./noDiscoveryPrompt";

describe("buildNoDiscoverySystemPrompt", () => {
  it("prioritizes retrieved RAG context", () => {
    const prompt = buildNoDiscoverySystemPrompt({ ragRequested: true, hasRagContext: true });

    expect(prompt).toContain("RAG retrieved relevant vault context");
    expect(prompt).toContain("primary vault source");
    expect(prompt).toContain("Do not guess note paths");
  });

  it("prevents guessing when RAG returns no results", () => {
    const prompt = buildNoDiscoverySystemPrompt({ ragRequested: true, hasRagContext: false });

    expect(prompt).toContain("returned no relevant vault context");
    expect(prompt).toContain("Do not fill the gap with assumptions");
  });

  it("directs current-note questions to the active note when RAG is off", () => {
    const prompt = buildNoDiscoverySystemPrompt({ ragRequested: false, hasRagContext: false });

    expect(prompt).toContain("RAG is not active");
    expect(prompt).toContain("current note as the primary vault source");
    expect(prompt).toContain("exact path explicitly supplied by the user");
  });
});
