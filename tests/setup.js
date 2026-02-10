// tests/setup.js
// Vitest 全局 setup
//
// 注入 testing-library matchers 和 mock 常用的浏览器/Electron API

import '@testing-library/jest-dom';

// Mock window.electron (Electron preload 注入的 API)
globalThis.window = globalThis.window || {};
window.electron = {
  store: {
    get: async () => ({}),
    set: async () => ({ success: true }),
    delete: async () => ({ success: true }),
    has: async () => false,
  },
  screenshot: {
    capture: () => {},
    onCaptured: () => () => {},
  },
  theme: {
    get: async () => ({ success: true, theme: 'light' }),
    onChanged: () => () => {},
  },
  ipcRenderer: {
    on: () => {},
    removeListener: () => {},
    send: () => {},
    invoke: async () => null,
  },
};

// Mock localStorage
if (!globalThis.localStorage) {
  const store = {};
  globalThis.localStorage = {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}
