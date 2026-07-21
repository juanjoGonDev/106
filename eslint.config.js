import js from '@eslint/js';
import security from 'eslint-plugin-security';
import globals from 'globals';

const commonRules = {
  'curly': ['error', 'all'],
  'eqeqeq': ['error', 'always'],
  'no-alert': 'error',
  'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
  'no-implicit-coercion': 'error',
  'no-multi-assign': 'error',
  'no-new-func': 'error',
  'no-param-reassign': 'error',
  'no-restricted-globals': ['error', 'event'],
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.name='eval']",
      message: 'eval is forbidden.',
    },
    {
      selector: "NewExpression[callee.name='Function']",
      message: 'Dynamic Function construction is forbidden.',
    },
  ],
  'no-shadow': 'error',
  'no-throw-literal': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-useless-rename': 'error',
  'object-shorthand': 'error',
  'prefer-const': 'error',
  'prefer-template': 'error',
};

export default [
  {
    ignores: ['node_modules/**', 'public/config.js', 'coverage/**'],
  },
  js.configs.recommended,
  security.configs.recommended,
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: commonRules,
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.nodeBuiltin, ...globals.es2025 },
    },
    rules: {
      ...commonRules,
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.nodeBuiltin, ...globals.es2025 },
    },
    rules: {
      'no-unused-expressions': 'off',
    },
  },
];
