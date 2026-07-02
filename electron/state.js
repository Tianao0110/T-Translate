// Global state — two layers.
//   1. Persistent config (electron-store) — survives restarts.
//   2. Runtime state — in-memory, reset on every launch.
//
// Data-flow contract:
//   electron-store is the single source of truth for cross-process config.
//   Renderer reads/writes via IPC (store-get / store-set).
//   Renderer-side Zustand stores (config.js, translation-store.js) hold UI state
//   and mirror the relevant slices into electron-store on change (e.g. language,
//   theme). Main process only reads electron-store; it never injects into the
//   renderer with executeJavaScript.

const Store = require('electron-store');

const isDev = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged;

// One-time store-key migration from the legacy "glass" naming (pre-0.2.9).
// An old key present on disk means a pre-rename install — its value is the
// user's real data, so it simply moves; idempotent because the old key is
// deleted afterwards.
function migrateGlassKeys(s) {
  const renames = [
    ['glassBounds', 'floatingWindowBounds'],
    ['glassLocalSettings', 'floatingWindowLocal'],
    ['settings.glassWindow', 'settings.floatingWindow'],
    ['settings.shortcuts.glassWindow', 'settings.shortcuts.floatingWindow'],
  ];
  for (const [oldKey, newKey] of renames) {
    if (s.has(oldKey)) {
      s.set(newKey, s.get(oldKey));
      s.delete(oldKey);
    }
  }
}

const store = new Store({
  defaults: {
    // Window geometry
    windowBounds: { width: 1200, height: 800 },
    windowPosition: null,
    alwaysOnTop: false,
    startMinimized: false,

    // Floating (screen-translation overlay) window
    floatingWindowBounds: { width: 400, height: 200 },
    floatingWindowLocal: {},

    // Selection translate — disabled by default on every launch (user opts in per session).
    selectionEnabled: false,

    privacyMode: 'standard',

    // App-wide settings buckets.
    settings: {
      shortcuts: {},
      translation: {},
      ocr: {},
      interface: {},
      selection: {},
      screenshot: {},
      floatingWindow: {},
      providers: {},
      connection: {},
      tts: {
        enabled: true,
        engine: 'web-speech',
        voiceId: '',
        rate: 1.0,
        pitch: 1.0,
        volume: 0.8,
      },
    },
  },
});

migrateGlassKeys(store);

// In-memory state — reset on every launch.
const runtime = {
  isQuitting: false,
  isAppReady: false,

  selectionEnabled: false,  // Off by default each launch (mirror of store but cleared on start).

  // Window refs — accessed through `windows` getter/setter below.
  _windows: {
    main: null,
    floatingWindow: null,
    screenshot: null,
    selection: null,
  },

  // Screenshot pipeline
  screenshotData: null,
  wasMainWindowVisible: false,
  screenshotFromHotkey: false,
  lastScreenshotBounds: null,
  screenshotSelectionWindow: null,
  screenshotLoadingTimer: null,

  // Selection translate
  isDraggingOverlay: false,
  selectionHook: null,

  shortcutsRegistered: false,
};

// Window-ref proxy with getter/setter — lets us add dev-only logging without
// touching every caller.
const windows = {
  get main() { return runtime._windows.main; },
  set main(win) {
    runtime._windows.main = win;
    if (isDev && win) console.log('[State] Main window set');
  },

  get floatingWindow() { return runtime._windows.floatingWindow; },
  set floatingWindow(win) {
    runtime._windows.floatingWindow = win;
    if (isDev && win) console.log('[State] Floating window set');
  },

  get screenshot() { return runtime._windows.screenshot; },
  set screenshot(win) { runtime._windows.screenshot = win; },

  get selection() { return runtime._windows.selection; },
  set selection(win) { runtime._windows.selection = win; },

  getAll() {
    return { ...runtime._windows };
  },

  clearAll() {
    Object.keys(runtime._windows).forEach(key => {
      runtime._windows[key] = null;
    });
  },
};

// Reset helper — primarily for tests / edge recovery.
function resetRuntime() {
  runtime.isQuitting = false;
  runtime.selectionEnabled = false;
  runtime.screenshotData = null;
  runtime.wasMainWindowVisible = false;
  runtime.screenshotFromHotkey = false;
  runtime.isDraggingOverlay = false;
  windows.clearAll();
}

// Legacy aliases — kept for backwards compatibility with older call sites.
function getMainWindow() {
  return windows.main;
}

function setMainWindow(win) {
  windows.main = win;
}

module.exports = {
  store,
  runtime,
  windows,
  isDev,
  resetRuntime,
  getMainWindow,
  setMainWindow,
};
