// IPC channel constants — kills magic strings.

const CHANNELS = {
  SYSTEM: {
    MINIMIZE: 'minimize-window',
    MAXIMIZE: 'maximize-window',
    CLOSE: 'close-window',
    SET_ALWAYS_ON_TOP: 'set-always-on-top',
    OPEN_EXTERNAL: 'open-external',
    GET_PLATFORM: 'get-platform',
    GET_APP_PATH: 'get-app-path',
  },
  DIALOG: {
    SAVE: 'show-save-dialog',
    OPEN: 'show-open-dialog',
    SAVE_FILE: 'save-file',   // dialog + write in one round trip
  },
  STORE: {
    GET: 'store-get',
    SET: 'store-set',
    DELETE: 'store-delete',
    CLEAR: 'store-clear',
  },
  APP: {
    GET_VERSION: 'get-app-version',
    GET_PLATFORM: 'get-platform',
    CHECK_UPDATE: 'app:check-update',
    DOWNLOAD_UPDATE: 'app:download-update',
    INSTALL_UPDATE: 'app:install-update',
    SET_AUTO_LAUNCH: 'app:set-auto-launch',
    GET_AUTO_LAUNCH: 'app:get-auto-launch',
    GET_DATA_STATS: 'app:get-data-stats',
  },
  LOGS: {
    OPEN_DIRECTORY: 'logs:open-directory',
  },
  PRIVACY: {
    SET_MODE: 'privacy:setMode',
    GET_MODE: 'privacy:getMode',
  },
  SHORTCUTS: {
    UPDATE: 'shortcuts:update',
    PAUSE: 'shortcuts:pause',
    RESUME: 'shortcuts:resume',
  },
  SCREENSHOT: {
    CAPTURE: 'capture-screen',
    SELECTION: 'screenshot-selection',
    CANCEL: 'screenshot-cancel',
    CAPTURED: 'screenshot-captured',
    CAPTURED_SILENT: 'screenshot-captured-silent', // Silent mode — no main window pop.
    CONFIG: 'screenshot-config',
    OCR_COMPLETE: 'screenshot:ocr-complete',       // OCR done — forward text to selection window for translation.
  },
  FLOATING_WINDOW: {
    CLOSE: 'floating-window:close',
    GET_BOUNDS: 'floating-window:get-bounds',
    SET_POSITION: 'floating-window:set-position', // manual title-bar drag stream

    CAPTURE_REGION: 'floating-window:capture-region',
    SET_PASS_THROUGH: 'floating-window:set-pass-through',
    SET_OPACITY: 'floating-window:set-opacity',
    GET_SETTINGS: 'floating-window:get-settings',
    NOTIFY_SETTINGS_CHANGED: 'floating-window:notify-settings-changed',
    TRIGGER_CAPTURE: 'floating-window:trigger-capture', // global-hotkey re-capture (no focus steal)
    OPEN_MAIN_SETTINGS: 'floating-window:open-main-settings',
    GET_HISTORY: 'floating-window:get-history',
    ADD_TO_HISTORY: 'floating-window:add-to-history', // forward a translation into the main window's history
    ATTACH_AI_RESULT: 'floating-window:attach-ai-result',
    SETTINGS_CHANGED: 'floating-window:settings-changed',
    // Child pane standalone windows
    CREATE_CHILD_WINDOW: 'floating-window:create-child-window',
    CLOSE_CHILD_WINDOW: 'floating-window:close-child-window',
    CLOSE_ALL_CHILD_WINDOWS: 'floating-window:close-all-child-windows',
  },
  SELECTION: {
    TOGGLE: 'selection:toggle',
    HIDE: 'selection:hide',
    GET_ENABLED: 'selection:get-enabled',
    GET_TEXT: 'selection:get-text',
    SET_BOUNDS: 'selection:set-bounds',
    START_DRAG: 'selection:start-drag',
    ADD_TO_HISTORY: 'selection:add-to-history',
    ATTACH_AI_RESULT: 'selection:attach-ai-result',
    SHOW_TRIGGER: 'selection:show-trigger',
    SHOW_RESULT: 'selection:show-result',     // Direct result display (screenshot chain).
    SHOW_DIRECT: 'selection:show-direct',     // Sticky-direct path (skip trigger icon).
    SETTINGS_CHANGED: 'selection:settings-changed', // Provider/settings save → reload translation stack.
    STATE_CHANGED: 'selection-state-changed',
    // Multi-window support
    FREEZE: 'selection:freeze',
    CLOSE_FROZEN: 'selection:close-frozen',
  },
  CLIPBOARD: {
    WRITE_TEXT: 'clipboard:write-text',
    READ_TEXT: 'clipboard:read-text',
    READ_IMAGE: 'read-clipboard-image',
    WRITE_TEXT_LEGACY: 'write-clipboard-text',
    READ_TEXT_LEGACY: 'read-clipboard-text',
  },
  OCR: {
    CHECK_WINDOWS_OCR: 'ocr:check-windows-ocr',
    CHECK_INSTALLED: 'ocr:check-installed',
    PACKS_LIST: 'ocr:packs-list',
    PACKS_DOWNLOAD: 'ocr:packs-download',
    PACKS_REMOVE: 'ocr:packs-remove',
    DOWNLOAD_PROGRESS: 'ocr:download-progress',
    HEALTH_CHECK: 'ocr:health-check',
    SET_MODEL_TIER: 'ocr:set-model-tier',
  },
  MENU: {
    ACTION: 'menu-action',
    IMPORT_FILE: 'import-file',
  },
  DATA: {
    ADD_TO_HISTORY: 'add-to-history',
    ATTACH_AI_RESULT: 'attach-ai-result', // rides on an existing history entry, never its own
  },
  THEME: {
    GET: 'theme:get',
    SET: 'theme:set',
    CHANGED: 'theme:changed',
    SYNC: 'theme:sync',
  },
  SECURE_STORAGE: {
    ENCRYPT: 'secure-storage:encrypt',
    DECRYPT: 'secure-storage:decrypt',
    DELETE: 'secure-storage:delete',
    IS_AVAILABLE: 'secure-storage:isAvailable',
  },
  // Main-process translation stack (facade in ipc/translation-stack.js).
  // privacyMode/useCache never cross this boundary — the facade injects them.
  STACK: {
    TRANSLATE: 'stack:translate',
    STREAM_START: 'stack:translate-stream-start',
    STREAM_CHUNK: 'stack:stream-chunk',           // main → renderer push frames
    ABORT: 'stack:abort',
    CHAT: 'stack:chat',
    CHAT_CAPABILITY: 'stack:chat-capability',     // can any allowed provider chat()?
    TEST_PROVIDER: 'stack:test-provider',
    TEST_PROVIDER_CONFIG: 'stack:test-provider-config',
    PROVIDERS_STATUS: 'stack:providers-status',
    CURRENT_PROVIDER: 'stack:current-provider',
    RELOAD: 'stack:reload',
    CLEAR_CACHE: 'stack:clear-cache',
    CACHE_STATS: 'stack:cache-stats',
    CHANGED: 'stack:changed',                     // main → renderer: stack reloaded
    OCR_RECOGNIZE: 'stack:ocr-recognize',         // allowedEngines injected main-side
    OCR_RESET_VISION: 'stack:ocr-reset-vision',
    VISION_CHAT: 'stack:vision-chat',             // path B: prompt + capture to a vision model
    VISION_CAPABILITY: 'stack:vision-capability', // may path B run under the live privacy mode?
  },
  // AI action result windows (ipc/ai-result.js). Owned by the window that asked
  // for them, so the spawning card takes them down when its session ends.
  AI_RESULT: {
    OPEN: 'ai-result:open',
    PAYLOAD: 'ai-result:payload',                 // window pulls its own content
    RESIZE: 'ai-result:resize',                   // window reports its fitted height
    CLOSE: 'ai-result:close',
  },
};

const MENU_ACTIONS = {
  NEW_TRANSLATION: 'new-translation',
  EXPORT_TRANSLATION: 'export-translation',
  OPEN_SETTINGS: 'open-settings',
  LLM_SETTINGS: 'llm-settings',
  OCR_SETTINGS: 'ocr-settings',
  SHOW_HISTORY: 'show-history',
  SHOW_FAVORITES: 'show-favorites',
  SHOW_SHORTCUTS: 'show-shortcuts',
  CLEAR_CONTENT: 'clear-content',
  QUICK_TRANSLATE: 'quick-translate',
  SWITCH_LANGUAGE: 'switch-language',
};

const PRIVACY_MODES = {
  STANDARD: 'standard',
  OFFLINE: 'offline',
  // SECURE was missing here, so privacy:setMode('secure') failed validation
  // and the main-process mode key silently kept its previous value.
  SECURE: 'secure',
};

module.exports = { CHANNELS, MENU_ACTIONS, PRIVACY_MODES };

// Add `default` export for Vite ESM consumers.
module.exports.default = module.exports;
