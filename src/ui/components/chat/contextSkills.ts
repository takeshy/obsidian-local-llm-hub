export function resolveEffectiveSkillPaths(
  activeSkillPaths: string[],
  activeContextSkillPath: string | null,
  disabledContextSkillPaths: ReadonlySet<string>,
  contextSkillPaths: ReadonlySet<string>,
  requestedSkillPath?: string,
): string[] {
  let effectiveSkillPaths = activeSkillPaths;
  if (requestedSkillPath && !effectiveSkillPaths.includes(requestedSkillPath)) {
    effectiveSkillPaths = [...effectiveSkillPaths, requestedSkillPath];
  }

  // An explicitly requested context skill applies to this send even when its
  // automatic selection has been disabled in the UI.
  if (requestedSkillPath && contextSkillPaths.has(requestedSkillPath)) {
    return effectiveSkillPaths.filter(path =>
      !contextSkillPaths.has(path) || path === requestedSkillPath
    );
  }

  if (!activeContextSkillPath || disabledContextSkillPaths.has(activeContextSkillPath)) {
    return effectiveSkillPaths;
  }

  const withoutContextSkills = effectiveSkillPaths.filter(path => !contextSkillPaths.has(path));
  return [activeContextSkillPath, ...withoutContextSkills];
}
