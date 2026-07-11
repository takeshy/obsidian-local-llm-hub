import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';

const BRANDS = [...DEFAULT_BRANDS, 'Local LLM Hub'];

export default tseslint.config(
  {
    ignores: ['main.js', 'node_modules/**', 'scripts/*.mjs', '*.js', '*.mjs', 'src/**/*.test.ts', 'vitest.config.ts'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: true,
      },
    },
    plugins: {
      obsidianmd,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      'obsidianmd/commands/no-command-in-command-id': 'error',
      'obsidianmd/commands/no-command-in-command-name': 'error',
      'obsidianmd/commands/no-default-hotkeys': 'error',
      'obsidianmd/commands/no-plugin-id-in-command-id': 'error',
      'obsidianmd/commands/no-plugin-name-in-command-name': 'error',
      'obsidianmd/settings-tab/no-manual-html-headings': 'error',
      'obsidianmd/settings-tab/no-problematic-settings-headings': 'error',
      'obsidianmd/vault/iterate': 'error',
      'obsidianmd/detach-leaves': 'error',
      'obsidianmd/hardcoded-config-path': 'error',
      'obsidianmd/no-forbidden-elements': 'error',
      'obsidianmd/no-plugin-as-component': 'error',
      'obsidianmd/no-sample-code': 'error',
      'obsidianmd/no-tfile-tfolder-cast': 'error',
      'obsidianmd/no-view-references-in-plugin': 'error',
      'obsidianmd/no-static-styles-assignment': 'error',
      'obsidianmd/object-assign': 'error',
      'obsidianmd/platform': 'error',
      'obsidianmd/prefer-file-manager-trash-file': 'warn',
      'obsidianmd/prefer-abstract-input-suggest': 'error',
      'obsidianmd/regex-lookbehind': 'error',
      'obsidianmd/sample-names': 'error',
      'obsidianmd/validate-manifest': 'error',
      'obsidianmd/validate-license': 'error',
      'obsidianmd/ui/sentence-case': 'error',
      'obsidianmd/ui/sentence-case-locale-module': ['error', {
        brands: BRANDS,
        ignoreWords: ['RAG', 'OKF'],
      }],

      'no-case-declarations': 'error',
      'no-useless-escape': 'error',
    },
  },
);
