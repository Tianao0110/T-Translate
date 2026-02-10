// eslint.config.js
// ESLint flat config for T-Translate (Electron + React + Vite)
//
// 策略: 宽松起步，不阻塞开发
//   - 只报真正的 bug (未使用变量、未定义变量等)
//   - React hooks 规则 (防止内存泄漏)
//   - 不强制代码风格 (由 Prettier 负责)

import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
  // 全局忽略
  {
    ignores: [
      'build/**',
      'dist/**',
      'node_modules/**',
      'resources/**',
      '*.old',
      '*.backup.*',
    ],
  },

  // ========== 渲染进程 (src/) ==========
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        // Electron preload 注入的全局对象
        window: 'readonly',
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      react: { version: '18.2' },
    },
    rules: {
      // --- 基础质量 ---
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      'no-console': 'off', // 允许 console (项目有自己的 logger)
      'no-debugger': 'warn',
      'no-constant-condition': ['error', { checkLoops: false }],
      'prefer-const': 'warn',

      // --- React ---
      'react/jsx-uses-react': 'off',     // React 17+ 不需要
      'react/react-in-jsx-scope': 'off', // React 17+ 不需要
      'react/prop-types': 'off',         // 不强制 PropTypes
      'react/display-name': 'off',       // memo 组件已手动设置

      // --- React Hooks (重要!) ---
      'react-hooks/rules-of-hooks': 'error',     // hooks 调用规则
      'react-hooks/exhaustive-deps': 'warn',     // deps 数组完整性

      // --- 放宽的规则 ---
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
      'no-async-promise-executor': 'warn',
    },
  },

  // ========== 主进程 (electron/) ==========
  {
    files: ['electron/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs', // 主进程用 CommonJS
      globals: {
        ...globals.node,
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-console': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
      'prefer-const': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
    },
  },

  // ========== 配置文件 / 脚本 ==========
  {
    files: ['vite.config.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
    },
  },
];
