// Global state: the electron-store (persistent, the one source of cross-process
// config; renderers reach it over store-get / store-set) and the in-memory
// runtime + window refs. Contract: docs/design/main-process.md §8.

const Store = require('electron-store');
const { pruneRetiredSettings } = require('./platform/store-cleanup');

const isDev = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged;

// One-time key rename from the pre-0.2.9 "glass" naming; idempotent.
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

    selectionEnabled: false,

    privacyMode: 'standard',

    // App-wide settings buckets (no retired buckets seeded here).
    settings: {
      shortcuts: {},
      translation: {},
      ocr: {},
      interface: {},
      selection: {},
      screenshot: {},
      floatingWindow: {},
      // Must stay value-identical to DEFAULT_TTS_CONFIG in src/tts/index.js.
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
pruneRetiredSettings(store);

// In-memory state — reset on every launch.
const runtime = {
  isQuitting: false,
  isAppReady: false,

  // Boot-time decision by crash-guard (main.js).
  safeMode: false,

  // "Open with" file, consumed once by the renderer's take-pending IPC.
  pendingOpenFile: null,

  selectionEnabled: false, // off on every launch

  // Window refs, accessed through `windows` below.
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

// Window-ref proxy (dev logging on set).
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

function getMainWindow() {
  return windows.main;
}

module.exports = {
  store,
  runtime,
  windows,
  isDev,
  getMainWindow,
};
