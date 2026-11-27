import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/', '**/dist-seed/', '**/coverage/', '**/.turbo/', '**/src/generated/']),
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/pos/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  // The network is never on the checkout path (CLAUDE.md rule 1).
  {
    files: ['apps/pos/src/**/*.{ts,tsx}'],
    ignores: ['apps/pos/src/sync/api-client.ts', 'apps/pos/src/test/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Only sync/api-client.ts may use the network.' },
      ],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].map((object) => ({
          object,
          property: 'fetch',
          message: 'Only sync/api-client.ts may use the network.',
        })),
      ],
    },
  },
  {
    files: ['apps/pos/src/{catalog,checkout,db,staff}/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '/sync(/|$)', message: 'Local code must not depend on the network layer.' },
          ],
        },
      ],
    },
  },
  prettier,
);
