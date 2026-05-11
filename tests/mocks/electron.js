// Minimal Electron-module stub for Vitest.
// Importing main-process code in a unit test pulls in `require('electron')`,
// which would otherwise fail under Node. Tests that care about a specific
// API behavior should override the stub locally with vi.mock.

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
