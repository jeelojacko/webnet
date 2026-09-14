import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tsParser from '@typescript-eslint/parser';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  // public/rtklib-* are dev-serving symlinks into cpp/build-wasm (generated Emscripten glue, never linted).
  globalIgnores(['dist', 'dist-webnet', 'test-results', 'playwright-report', 'emsdk-cache', 'cpp/build*', 'public/rtklib-*', 'study-desktop/dist', 'study-desktop/src-tauri/target', 'artifacts']),
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    ignores: ['node_modules'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
