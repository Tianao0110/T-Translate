// Path config — single place to manage HTML / preload / resource paths across dev and prod.
//
// Usage:
//   const PATHS = require('./shared/paths');
//   mainWindow.loadFile(PATHS.pages.main.file);
//   mainWindow.loadURL(PATHS.pages.main.url);

const path = require('path');

// Detect dev mode without app.isPackaged — this file can load before app is ready.
const isDev = process.env.NODE_ENV === 'development' ||
              process.argv.includes('--dev') ||
              !process.defaultApp === false;

const DEV_SERVER = 'http://localhost:5173';

// All paths resolve relative to electron/shared/.
const BASE_DIR = path.join(__dirname, '../..');
const ELECTRON_DIR = path.join(__dirname, '..');

const preloads = {
  main: path.join(ELECTRON_DIR, 'preloads/main.js'),
  selection: path.join(ELECTRON_DIR, 'preloads/selection.js'),
  glass: path.join(ELECTRON_DIR, 'preloads/glass.js'),
  childPane: path.join(ELECTRON_DIR, 'preloads/child-pane.js'),
  screenshot: path.join(ELECTRON_DIR, 'preloads/screenshot.js'),
};

// Each page exposes both `url` (dev server) and `file` (prod build).
const pages = {
  main: {
    url: DEV_SERVER,
    file: path.join(BASE_DIR, 'build/index.html'),
  },
  selection: {
    url: `${DEV_SERVER}/selection.html`,
    file: path.join(BASE_DIR, 'build/selection.html'),
  },
  glass: {
    url: `${DEV_SERVER}/glass.html`,
    file: path.join(BASE_DIR, 'build/glass.html'),
  },
  screenshot: {
    // Screenshot page is plain HTML — not processed by Vite.
    url: path.join(BASE_DIR, 'public/screenshot.html'),
    file: isDev
      ? path.join(BASE_DIR, 'public/screenshot.html')
      : path.join(process.resourcesPath, 'resources/screenshot.html'),
  },
  childPane: {
    // Child glass pane — standalone window (plain HTML + inline JS).
    url: `${DEV_SERVER}/child-pane.html`,
    file: isDev
      ? path.join(BASE_DIR, 'public/child-pane.html')
      : path.join(process.resourcesPath, 'resources/child-pane.html'),
  },
};

// extraResources land in process.resourcesPath after packaging.
const resources = {
  icon: isDev
    ? path.join(BASE_DIR, 'public/icon.png')
    : path.join(process.resourcesPath, 'resources/icon.png'),
  trayIcon: isDev
    ? path.join(BASE_DIR, 'public/tray-icon.ico')
    : path.join(process.resourcesPath, 'resources/tray-icon.ico'),
  ocrData: isDev
    ? path.join(BASE_DIR, 'resources/ocr')
    : path.join(process.resourcesPath, 'resources/ocr'),
};

// Load a page, picking dev URL vs prod file based on environment.
function loadPage(window, pageName, devMode = isDev) {
  const page = pages[pageName];
  if (!page) {
    throw new Error(`Unknown page: ${pageName}`);
  }

  if (devMode && pageName !== 'screenshot') {
    window.loadURL(page.url);
  } else {
    window.loadFile(page.file);
  }
}

function getPreload(name) {
  const preload = preloads[name];
  if (!preload) {
    throw new Error(`Unknown preload: ${name}`);
  }
  return preload;
}

module.exports = {
  preloads,
  pages,
  resources,
  loadPage,
  getPreload,
  isDev,
  DEV_SERVER,
  BASE_DIR,
  ELECTRON_DIR,
};
