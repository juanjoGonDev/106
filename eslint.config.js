import js from '@eslint/js';
import security from 'eslint-plugin-security';
import globals from 'globals';

const securityRules = Object.fromEntries(
  Object.keys(security.rules).map((ruleName) => [`security/${ruleName}`, 'error']),
);

const projectRules = {
  ...securityRules,
  'eqeqeq': ['error', 'always'],
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
  'no-undef': 'error',
  'no-unreachable': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-useless-escape': 'error',
  'prefer-const': 'error',
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
  js.configs.recommended,
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
