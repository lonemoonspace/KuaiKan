// Minimal ESLint flat config. This project deliberately only turns on the
// two react-hooks rules plus @typescript-eslint/no-unused-vars (not a full
// lint ruleset). `react-hooks/exhaustive-deps` in particular is the rule
// this project has been bitten by before (1.5.1: a stale closure over the
// summarize handler made the summarize button a no-op — see
// `summarizeContextRef` in entrypoints/content/summary/useContentApp.ts), so
// it's worth actually running even though nothing else is linted yet.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['.wxt/**', '.output/**', 'node_modules/**', 'stats.html'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
    },
  },
);
