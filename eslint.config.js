import js from '@eslint/js';
import globals from 'globals';

// Lenient flat config for the existing browser scripts. Stylistic rules are
// off so the compact source keeps passing; no-undef stays on, with the
// MapLibre global that index.html loads from a script tag.
export default [
  {
    ignores: ['docs/**', 'www/**', 'android/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        maplibregl: 'readonly',
      },
    },
    rules: {
      // Existing code uses empty catch / empty rejection handlers on purpose.
      'no-empty': 'off',
      // agent.js returns the geolocation call from a Promise executor.
      'no-promise-executor-return': 'off',
      // Unused catch bindings are already in the source. Unused imports are warnings
      // so an in-progress edit does not fail CI; ESLint still exits 0.
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
    rules: {
      'no-empty': 'off',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['proxy/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.js', 'tests/**/*.mjs', 'eslint.config.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-empty': 'off',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
];
