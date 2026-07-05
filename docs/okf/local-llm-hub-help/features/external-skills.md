---
type: Feature
title: External skills
description: Installing trusted skill packages into the vault skills folder.
tags:
  - skills
  - import
---

# External skills

External skills are copied into the vault `skills/` folder. A valid skill package contains a `SKILL.md` and a manifest. Compatibility metadata controls whether a skill should install for this host plugin.

For Local LLM Hub, host-specific patches can adapt shared skill instructions from cloud-oriented wording to local LLM wording. Skills should avoid assuming Gemini-only features unless the user configured a compatible endpoint.

Install flow:

1. Open plugin settings.
2. Open External skills.
3. Select a compatible skill from Install a skill.
4. Install it into the configured skills folder.
5. Enable the installed skill from the chat skill selector.

Installed external skills show their version. If the official skill repository has a newer compatible version, the settings panel can check and install the update. Incompatible packages are skipped based on manifest metadata rather than installed blindly.
