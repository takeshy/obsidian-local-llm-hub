# Agent Skills

Agent skills allow you to inject reusable instructions and reference materials into the AI's system prompt. Each skill is a folder containing a `SKILL.md` file with optional reference files.

## Folder Structure

Skills are stored under `{workspaceFolder}/{skillsFolder}/` (default: `LocalLlmHub/skills/`). Each subfolder containing a `SKILL.md` is discovered as a skill.

```
LocalLlmHub/
  skills/
    code-review/
      SKILL.md
      references/
        coding-standards.md
        review-checklist.md
    translator/
      SKILL.md
    meeting-notes/
      SKILL.md
      references/
        template.md
```

## SKILL.md Format

Each `SKILL.md` file has YAML frontmatter with metadata, followed by the instruction body in markdown.

```markdown
---
name: Code Review
description: Reviews code for quality, security, and best practices
---

You are an expert code reviewer. When reviewing code:

1. Check for security vulnerabilities (injection, XSS, etc.)
2. Identify performance issues
3. Suggest improvements for readability
4. Verify error handling is adequate

Always provide specific line references and concrete suggestions.
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Display name (defaults to folder name) |
| `description` | No | Short description shown in the skill selector dropdown |

### Instruction Body

The markdown body after the frontmatter is injected into the system prompt when the skill is active. Write clear, specific instructions that guide the AI's behavior.

## Reference Files

Place additional files in a `references/` subfolder to provide context. All files in this folder are loaded and appended to the skill's system prompt section.

```
code-review/
  SKILL.md
  references/
    coding-standards.md    # Your team's coding standards
    review-checklist.md    # Checklist to follow
```

Reference files are included as:

```
### References

[coding-standards.md]
(file contents)

[review-checklist.md]
(file contents)
```

Use references for content that the AI should know but that isn't an instruction — coding standards, templates, style guides, glossaries, etc.

## Using Skills in Chat

1. Skills are automatically discovered from the configured skills folder
2. A skill selector bar (with a sparkle icon) appears above the chat messages when skills are available
3. Click **+** to open the dropdown and check/uncheck skills
4. Active skills appear as chips — click **×** to deactivate
5. Selected skills remain active across messages within the same chat session

When skills are active, the system prompt includes:

```
The following agent skills are active:

## Skill: Code Review

(instructions from SKILL.md)

### References

(contents of reference files)
```

The assistant message metadata shows which skills were used (displayed as "Skills used: ...").

## Configuration

In plugin settings under **Workspace**:

| Setting | Default | Description |
|---------|---------|-------------|
| Skills folder | `skills` | Subfolder name relative to the workspace folder |

The full path is `{workspaceFolder}/{skillsFolder}` (e.g. `LocalLlmHub/skills`).

## Examples

### Translator

```markdown
---
name: Translator
description: Translates text between languages
---

You are a professional translator. When translating:

- Preserve the original meaning and tone
- Use natural expressions in the target language
- Keep technical terms consistent
- If the source language is ambiguous, ask for clarification
```

### Meeting Notes

```markdown
---
name: Meeting Notes
description: Structures meeting notes with action items
---

When processing meeting notes:

1. Identify participants and their roles
2. Extract key decisions made
3. List action items with owners and deadlines
4. Summarize discussion points by topic
5. Flag any unresolved issues

Format output using the template in the references.
```

With `references/template.md`:

```markdown
# Meeting: {title}
**Date:** {date}
**Participants:** {list}

## Decisions
- ...

## Action Items
- [ ] {task} — @{owner} (due: {date})

## Discussion Summary
### {topic}
...

## Open Issues
- ...
```

### Writing Assistant

```markdown
---
name: Writing Assistant
description: Helps improve writing style and clarity
---

You are a writing coach. When reviewing text:

- Fix grammar and spelling errors
- Improve sentence structure for clarity
- Suggest stronger word choices
- Maintain the author's voice and intent
- Point out repetition or redundancy

Provide the revised text first, then list the changes you made and why.
```
