interface NoDiscoveryPromptOptions {
  ragRequested: boolean;
  hasRagContext: boolean;
}

/** Instructions that keep no-discovery mode useful without turning reads into path guessing. */
export function buildNoDiscoverySystemPrompt({
  ragRequested,
  hasRagContext,
}: NoDiscoveryPromptOptions): string {
  const common = [
    "No-discovery mode is active for the vault.",
    "Vault search and note listing are unavailable.",
    "Do not guess note paths, probe likely filenames, or use folder listings and other tools as a substitute for discovering notes.",
    "Do not infer facts about the user's vault or product from the available tool names.",
    "Make factual claims only when supported by the conversation, attached or explicitly referenced content, active knowledge bundles, or retrieved vault context.",
  ].join(" ");

  let sourceGuidance: string;
  if (hasRagContext) {
    sourceGuidance = "RAG retrieved relevant vault context for this turn. Use the supplied 'Relevant context from user's notes' as the primary vault source. You may use get_active_note when the user explicitly asks about the current note, and read_note only for an exact path explicitly supplied by the user or shown in a retrieved source citation.";
  } else if (ragRequested) {
    sourceGuidance = "RAG was requested, but it returned no relevant vault context. Do not fill the gap with assumptions or guessed file reads. You may use get_active_note when the user explicitly asks about the current note, and read_note only for an exact path explicitly supplied by the user.";
  } else {
    sourceGuidance = "RAG is not active for this turn. When vault context is needed, use get_active_note and treat the current note as the primary vault source. Use read_note only for an exact path explicitly supplied by the user. Treat attached content and explicit note references as the other available vault context.";
  }

  const fallback = "If these sources are insufficient, say what information is missing and ask the user to reference or attach the relevant note, or to switch to Vault: all. Do not present a speculative synthesis as established fact.";
  return `\n\n${common} ${sourceGuidance} ${fallback}`;
}
