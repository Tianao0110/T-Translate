// Vitest 用 electron 模块 mock
// 单测里 import 主进程代码会触发 require('electron')；这里给最小 stub 让模块加载不挂。
// 真要测某个 electron API 行为，在 test 文件里用 vi.mock 覆盖具体方法。

import { vi } from 'vitest';

const mockBrowserWindow = vi.fn();
mockBrowserWindow.getAllWindows = vi.fn(() => []);
mockBrowserWindow.getFocusedWindow = vi.fn(() => null);
mockBrowserWindow.fromWebContents = vi.fn(() => null);

export const BrowserWindow = mockBrowserWindow;

export const app = {
  getPath: vi.fn(() => '/mock/path'),
  isReady: vi.fn(() => true),
  whenReady: vi.fn(() => Promise.resolve()),
  on: vi.fn(),
  quit: vi.fn(),
  getVersion: vi.fn(() => '0.0.0-test'),
};

export const screen = {
  getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
  getDisplayNearestPoint: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })),
  getPrimaryDisplay: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 })),
};

export const clipboard = {
  readText: vi.fn(() => ''),
  writeText: vi.fn(),
  clear: vi.fn(),
};

export const ipcMain = {
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
};

export const ipcRenderer = {
  on: vi.fn(() => () => {}),
  send: vi.fn(),
  invoke: vi.fn(() => Promise.resolve()),
  removeListener: vi.fn(),
};

export const Menu = {
  buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
  setApplicationMenu: vi.fn(),
};

export const Tray = vi.fn();
export const nativeImage = { createFromPath: vi.fn(() => ({})) };
export const dialog = {
  showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
  showErrorBox: vi.fn(),
};
export const shell = { openExternal: vi.fn(() => Promise.resolve()) };
export const globalShortcut = { register: vi.fn(), unregister: vi.fn(), unregisterAll: vi.fn() };

export default {
  BrowserWindow, app, screen, clipboard,
  ipcMain, ipcRenderer, Menu, Tray, nativeImage, dialog, shell, globalShortcut,
};
