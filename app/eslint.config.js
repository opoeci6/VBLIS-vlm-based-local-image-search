import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

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
    files: ['electron/**/*.{js,mjs}', '*.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
]
