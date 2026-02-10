// vitest.config.js
// 测试配置 - Vitest
//
// 使用与 Vite 相同的别名配置，确保测试中 @config 等路径正常工作

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@services': path.resolve(__dirname, 'src/services'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@stores': path.resolve(__dirname, 'src/stores'),
      '@config': path.resolve(__dirname, 'src/config'),
    },
  },
  test: {
    // 使用 jsdom 环境（React 组件测试需要）
    environment: 'jsdom',

    // 全局注入 describe, it, expect 等（jest-dom 需要）
    globals: true,

    // 全局 setup（注入 testing-library matchers）
    setupFiles: ['./tests/setup.js'],

    // 测试文件匹配模式
    include: [
      'tests/**/*.{test,spec}.{js,jsx}',
      'src/**/*.{test,spec}.{js,jsx}',
    ],

    // 排除
    exclude: ['node_modules', 'build', 'dist'],

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/i18n/**',
        'src/styles/**',
        'src/**/*.css',
      ],
    },
  },
});
