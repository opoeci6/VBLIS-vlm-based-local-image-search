import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// User-facing text belongs in src/i18n/locales. Both rules below use this level; the last step of the
// translation work flips it from 'warn' to 'error' (a one-line change).
const I18N_LEVEL = 'warn';

const I18N_HINT = 'Put user-facing text in src/i18n/locales and use t() (see src/i18n/index.js).';

// jsx-no-literals only sees plain JSX text. These selectors catch what it never sees: strings inside
// conditionals, template literals and logical expressions, in JSX children, in text-like attributes and
// in properties that hold messages (toasts, labels, titles).
const JSX_CHILD = ':matches(JSXElement,JSXFragment) > JSXExpressionContainer';
const ATTR = 'JSXAttribute[name.name=/^(title|aria-label|placeholder|alt)$/]';
const PROP = 'Property[key.name=/^(message|label|title|desc|description)$/]';
const LETTERS = '/[A-Za-z]{2}/';

const textSelectors = (parent) => [
  `${parent} > Literal[value=${LETTERS}]`,
  `${parent} > ConditionalExpression > Literal[value=${LETTERS}]`,
  `${parent} > ConditionalExpression > ConditionalExpression > Literal[value=${LETTERS}]`,
  `${parent} > TemplateLiteral > TemplateElement[value.raw=${LETTERS}]`,
  `${parent} > ConditionalExpression > TemplateLiteral > TemplateElement[value.raw=${LETTERS}]`,
  `${parent} > LogicalExpression > Literal[value=${LETTERS}]`,
];

const hardCodedTextSelectors = [
  ...textSelectors(JSX_CHILD),
  `${ATTR} > Literal[value=${LETTERS}]`,
  ...textSelectors(`${ATTR} > JSXExpressionContainer`),
  ...textSelectors(PROP),
];

export default [
  { ignores: ['dist', 'dist-electron'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: '18.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/jsx-no-target-blank': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Raw fetch skips the API token header; apiFetch adds it
    files: ['src/**/*.{js,jsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Use apiFetch from src/utils/api.js, it adds the API token.' },
      ],
    },
  },
  {
    files: ['src/utils/api.js', '**/*.test.{js,jsx}', 'src/test/setup.js'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['**/*.test.{js,jsx}', 'src/test/**', 'src/utils/asciiLogoPoints.js'],
    rules: {
      'react/jsx-no-literals': [
        I18N_LEVEL,
        { allowedStrings: ['(', ')', '·', '%', '/', '#', '+', '•', ':', '1', '4', '8', '16', '32', '64', 'VBLIS', 'X'] },
      ],
      'no-restricted-syntax': [
        I18N_LEVEL,
        ...hardCodedTextSelectors.map(selector => ({ selector, message: I18N_HINT })),
      ],
    },
  },
  {
    files: ['electron/**/*.{js,mjs}', '*.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
]
