# Shared library package

`obsidian-llm-hub-common-0.1.0.tgz` contains the prebuilt shared library, including
its JavaScript and TypeScript declarations. Using the archive allows review
tools to install the dependency with `npm ci --ignore-scripts`; installing from
Git requires the library's `prepare` script to generate its `dist` directory.

Source: https://github.com/takeshy/obsidian-llm-hub-common/tree/ba60ee73932fe12ebc3a0a9a807fb7e8be14e97f

Archive integrity:

```text
sha512-iAMTNuLfjQ59Lq759iLBlqM4Z+EzYe6j0Owim84B+xyNOZk5Rwdklven6cARffzhyW17dLs7W8KyVY5aKDNwCw==
```

To update it, build and test the shared library at the intended commit, then
create its package with `npm pack`. Replace the archive, record the source
commit and integrity here, and update the dependency and lockfile. Verify a
fresh `npm ci --ignore-scripts`, followed by lint and build, before committing.

The MIT license is included in the archive.
