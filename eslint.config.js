import js from '@eslint/js';
import security from 'eslint-plugin-security';
import globals from 'globals';

const projectRules = {
  ...js.configs.recommended.rules,
  eqeqeq: ['error', 'smart'],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-prototype-builtins': 'error',
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.object.name='document'][callee.property.name='write']",
      message: 'document.write is forbidden.',
    },
  ],
  'no-throw-literal': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'prefer-const': 'error',
  'security/detect-buffer-noassert': 'error',
  'security/detect-child-process': 'error',
  'security/detect-disable-mustache-escape': 'error',
  'security/detect-eval-with-expression': 'error',
  'security/detect-new-buffer': 'error',
  'security/detect-no-csrf-before-method-override': 'error',
  'security/detect-pseudoRandomBytes': 'error',
  'security/detect-unsafe-regex': 'error',
};

export default [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'public/config.js',
      'supabase/functions/**/*.ts',
    ],
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    plugins: { security },
    rules: projectRules,
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.nodeBuiltin, ...globals.es2025 },
    },
    plugins: { security },
    rules: {
      ...projectRules,
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },
];