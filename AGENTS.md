# Repository Instructions

## Version bumps

- Do not create Git tags when bumping versions in this repository. Release tags are created by the release workflow.
- Use `npm version patch|minor|major`; `.npmrc` disables npm's automatic version commit and Git tag.
- After validation, create only the version bump commit. Do not create a tag manually.
