import { describe, expect, it } from "vitest";
import { resolveEffectiveSkillPaths } from "./contextSkills";

const DASHBOARD = "runtime:dashboard";
const CUSTOM = "custom:review";
const CONTEXT_SKILLS = new Set([DASHBOARD]);

describe("resolveEffectiveSkillPaths", () => {
  it("automatically selects the active file context", () => {
    expect(resolveEffectiveSkillPaths(
      [CUSTOM], DASHBOARD, new Set(), CONTEXT_SKILLS,
    )).toEqual([DASHBOARD, CUSTOM]);
  });

  it("keeps an automatically selected context skill disabled after removal", () => {
    expect(resolveEffectiveSkillPaths(
      [CUSTOM], DASHBOARD, new Set([DASHBOARD]), CONTEXT_SKILLS,
    )).toEqual([CUSTOM]);
  });

  it("allows an explicitly requested context skill for a single send", () => {
    expect(resolveEffectiveSkillPaths(
      [CUSTOM], DASHBOARD, new Set([DASHBOARD]), CONTEXT_SKILLS, DASHBOARD,
    )).toEqual([CUSTOM, DASHBOARD]);
  });
});
