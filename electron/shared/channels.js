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
    MESSAGE: 'show-message-box',
  },
  STORE: {
    GET: 'store-get',
    SET: 'store-set',
    DELETE: 'store-delete',
    CLEAR: 'store-clear',
    HAS: 'store-has',
  },
  APP: {
    GET_VERSION: 'get-app-version',
    GET_PLATFORM: 'get-platform',
    HEALTH_CHECK: 'api:health-check',
    CHECK_UPDATE: 'app:check-update',
    DOWNLOAD_UPDATE: 'app:download-update',
    INSTALL_UPDATE: 'app:install-update',
    SET_AUTO_LAUNCH: 'app:set-auto-launch',
    GET_AUTO_LAUNCH: 'app:get-auto-launch',
    GET_DATA_STATS: 'app:get-data-stats',
  },
  LOGS: {
    OPEN_DIRECTORY: 'logs:open-directory',
    GET_DIRECTORY: 'logs:get-directory',
  },
  PRIVACY: {
    SET_MODE: 'privacy:setMode',
    GET_MODE: 'privacy:getMode',
  },
  SHORTCUTS: {
    GET: 'shortcuts:get',
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
    SCREEN_BOUNDS: 'screen-bounds',
    OCR_COMPLETE: 'screenshot:ocr-complete',       // OCR done — forward text to selection window for translation.
  },
  GLASS: {
    OPEN: 'glass:open',
    CLOSE: 'glass:close',
    GET_BOUNDS: 'glass:get-bounds',
    CAPTURE_REGION: 'glass:capture-region',
    SET_PASS_THROUGH: 'glass:set-pass-through',
    SET_OPACITY: 'glass:set-opacity',
    GET_SETTINGS: 'glass:get-settings',
    GET_PROVIDER_CONFIGS: 'glass:get-provider-configs',
    NOTIFY_SETTINGS_CHANGED: 'glass:notify-settings-changed',
    OPEN_MAIN_SETTINGS: 'glass:open-main-settings',
    GET_HISTORY: 'glass:get-history',
    SETTINGS_CHANGED: 'glass:settings-changed',
    // Child pane standalone windows
    CREATE_CHILD_WINDOW: 'glass:create-child-window',
    CLOSE_CHILD_WINDOW: 'glass:close-child-window',
    CLOSE_ALL_CHILD_WINDOWS: 'glass:close-all-child-windows',
  },
  SUBTITLE: {
    TOGGLE_CAPTURE_WINDOW: 'subtitle:toggle-capture-window',
    GET_CAPTURE_RECT: 'subtitle:get-capture-rect',
    SET_CAPTURE_RECT: 'subtitle:set-capture-rect',
    CLEAR_CAPTURE_RECT: 'subtitle:clear-capture-rect',
    CAPTURE_REGION: 'subtitle:capture-region',
    IS_CAPTURE_WINDOW_VISIBLE: 'subtitle:is-capture-window-visible',
    CAPTURE_RECT_UPDATED: 'subtitle:capture-rect-updated',
  },
  SELECTION: {
    TOGGLE: 'selection:toggle',
    HIDE: 'selection:hide',
    GET_ENABLED: 'selection:get-enabled',
    GET_SETTINGS: 'selection:get-settings',
    GET_TEXT: 'selection:get-text',
    SET_POSITION: 'selection:set-position',
    SET_BOUNDS: 'selection:set-bounds',
    RESIZE: 'selection:resize',
    START_DRAG: 'selection:start-drag',
    ADD_TO_HISTORY: 'selection:add-to-history',
    SHOW_TRIGGER: 'selection:show-trigger',
    SHOW_RESULT: 'selection:show-result',     // Direct result display (screenshot chain).
    SHOW_DIRECT: 'selection:show-direct',     // Sticky-direct path (skip trigger icon).
    STATE_CHANGED: 'selection-state-changed',
    // Multi-window support
    FREEZE: 'selection:freeze',
    CLOSE_FROZEN: 'selection:close-frozen',
    GET_WINDOW_ID: 'selection:get-window-id',
    FROZEN_WINDOWS_COUNT: 'selection:frozen-windows-count',
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
    WINDOWS_OCR: 'ocr:windows-ocr',
    PADDLE_OCR: 'ocr:paddle-ocr',
    OCRSPACE: 'ocr:ocrspace',
    GOOGLE_VISION: 'ocr:google-vision',
    AZURE_OCR: 'ocr:azure-ocr',
    BAIDU_OCR: 'ocr:baidu-ocr',
    HEALTH_CHECK: 'ocr:health-check',
  },
  MENU: {
    ACTION: 'menu-action',
    IMPORT_FILE: 'import-file',
  },
  DATA: {
    ADD_TO_FAVORITES: 'add-to-favorites',
    ADD_TO_HISTORY: 'add-to-history',
    SYNC_TARGET_LANGUAGE: 'sync-target-language',
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
    GET_ACCESS_LOG: 'secure-storage:getAccessLog',
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
  STRICT: 'strict',
};

module.exports = { CHANNELS, MENU_ACTIONS, PRIVACY_MODES };

// Add `default` export for Vite ESM consumers.
module.exports.default = module.exports;
