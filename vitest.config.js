// Vitest config. Main-process modules load under jsdom through the electron
// stub in tests/mocks/electron.js.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      electron: path.resolve(__dirname, 'tests/mocks/electron.js'),
      // `import x from '/icon.png'` has no public-root meaning under vitest.
      '/icon.png': path.resolve(__dirname, 'public/icon.png'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: [
      'tests/**/*.{test,spec}.{js,jsx}',
      'src/**/*.{test,spec}.{js,jsx}',
    ],
    exclude: ['node_modules', 'build', 'dist'],
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
