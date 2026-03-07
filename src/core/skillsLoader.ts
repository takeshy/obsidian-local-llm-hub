import { type App, TFile, TFolder, parseYaml } from "obsidian";

export interface SkillMetadata {
  name: string;
  description: string;
  folderPath: string;      // e.g. "LocalLlmHub/skills/code-review"
  skillFilePath: string;   // e.g. "LocalLlmHub/skills/code-review/SKILL.md"
}

export interface LoadedSkill extends SkillMetadata {
  instructions: string;    // markdown body (after frontmatter)
  references: string[];    // contents of files in references/
}

/**
 * Discover all skills in the skills folder.
 * Each subfolder containing a SKILL.md is treated as a skill.
 */
export async function discoverSkills(app: App, skillsFolderPath: string): Promise<SkillMetadata[]> {
  const folder = app.vault.getAbstractFileByPath(skillsFolderPath);
  if (!(folder instanceof TFolder)) return [];

  const skills: SkillMetadata[] = [];

  for (const child of folder.children) {
    if (!(child instanceof TFolder)) continue;

    const skillFilePath = `${child.path}/SKILL.md`;
    const skillFile = app.vault.getAbstractFileByPath(skillFilePath);
    if (!(skillFile instanceof TFile)) continue;

    try {
      const content = await app.vault.cachedRead(skillFile);
      const { frontmatter } = parseFrontmatter(content);

      skills.push({
        name: (frontmatter.name as string) || child.name,
        description: (frontmatter.description as string) || "",
        folderPath: child.path,
        skillFilePath,
      });
    } catch {
      // Skip unreadable skill files
    }
  }

  return skills;
}

/**
 * Load a skill's full content including references.
 */
export async function loadSkill(app: App, metadata: SkillMetadata): Promise<LoadedSkill> {
  const skillFile = app.vault.getAbstractFileByPath(metadata.skillFilePath);
  if (!(skillFile instanceof TFile)) {
    return { ...metadata, instructions: "", references: [] };
  }

  const content = await app.vault.cachedRead(skillFile);
  const { body } = parseFrontmatter(content);

  // Collect reference files
  const references: string[] = [];
  const refsPath = `${metadata.folderPath}/references`;
  const refsFolder = app.vault.getAbstractFileByPath(refsPath);

  if (refsFolder instanceof TFolder) {
    for (const child of refsFolder.children) {
      if (child instanceof TFile) {
        try {
          const refContent = await app.vault.cachedRead(child);
          references.push(`[${child.name}]\n${refContent}`);
        } catch {
          // Skip unreadable reference files
        }
      }
    }
  }

  return {
    ...metadata,
    instructions: body.trim(),
    references,
  };
}

/**
 * Build a system prompt section from loaded skills.
 */
export function buildSkillSystemPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) return "";

  const parts = skills.map(skill => {
    let section = `## Skill: ${skill.name}\n\n${skill.instructions}`;
    if (skill.references.length > 0) {
      section += `\n\n### References\n\n${skill.references.join("\n\n")}`;
    }
    return section;
  });

  return `\n\nThe following agent skills are active:\n\n${parts.join("\n\n---\n\n")}`;
}

/**
 * Parse YAML frontmatter from markdown content.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  try {
    const frontmatter = (parseYaml(match[1]) as Record<string, unknown>) || {};
    return { frontmatter, body: match[2] };
  } catch {
    return { frontmatter: {}, body: match[2] };
  }
}
