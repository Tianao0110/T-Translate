// electron/shared/channels.js
// ============================================================
// IPC 通道常量表 - 消灭魔术字符串
// ============================================================
// 格式: CommonJS (主进程原生支持)

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
    CAPTURED_SILENT: 'screenshot-captured-silent', // 静默模式（不显示主窗口）
    CONFIG: 'screenshot-config',
    SCREEN_BOUNDS: 'screen-bounds',
    OCR_COMPLETE: 'screenshot:ocr-complete', // OCR 完成，发送文字给划词窗口翻译
  },
  GLASS: {
    OPEN: 'glass:open',
    CLOSE: 'glass:close',
    GET_BOUNDS: 'glass:get-bounds',
    TRANSLATE: 'glass:translate',
    CAPTURE_REGION: 'glass:capture-region',
    SET_PASS_THROUGH: 'glass:set-pass-through',
    SET_IGNORE_MOUSE: 'glass:set-ignore-mouse',
    SET_ALWAYS_ON_TOP: 'glass:set-always-on-top',
    SET_OPACITY: 'glass:set-opacity',
    GET_SETTINGS: 'glass:get-settings',
    SAVE_SETTINGS: 'glass:save-settings',
    GET_PROVIDER_CONFIGS: 'glass:get-provider-configs',
    NOTIFY_SETTINGS_CHANGED: 'glass:notify-settings-changed',
    ADD_TO_FAVORITES: 'glass:add-to-favorites',
    ADD_TO_HISTORY: 'glass:add-to-history',
    SYNC_TARGET_LANGUAGE: 'glass:sync-target-language',
    REFRESH: 'glass:refresh',
    SETTINGS_CHANGED: 'glass:settings-changed',
    TRANSLATE_REQUEST: 'glass:translate-request',
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
    SHOW_RESULT: 'selection:show-result',     // 直接显示翻译结果（截图联动用）
    STATE_CHANGED: 'selection-state-changed',
    // 多窗口支持
    FREEZE: 'selection:freeze',           // 冻结当前窗口（变成独立窗口）
    CLOSE_FROZEN: 'selection:close-frozen', // 关闭冻结的窗口
    GET_WINDOW_ID: 'selection:get-window-id', // 获取当前窗口 ID
    FROZEN_WINDOWS_COUNT: 'selection:frozen-windows-count', // 获取冻结窗口数量
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
    CHECK_PADDLE_OCR: 'ocr:check-paddle-ocr',
    CHECK_INSTALLED: 'ocr:check-installed',
    GET_AVAILABLE_ENGINES: 'ocr:get-available-engines',
    DOWNLOAD_ENGINE: 'ocr:download-engine',
    REMOVE_ENGINE: 'ocr:remove-engine',
    DOWNLOAD_PROGRESS: 'ocr:download-progress',
    WINDOWS_OCR: 'ocr:windows-ocr',
    PADDLE_OCR: 'ocr:paddle-ocr',
    OCRSPACE: 'ocr:ocrspace',
    GOOGLE_VISION: 'ocr:google-vision',
    AZURE_OCR: 'ocr:azure-ocr',
    BAIDU_OCR: 'ocr:baidu-ocr',
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
    GET: 'theme:get',                    // 获取当前主题
    SET: 'theme:set',                    // 设置主题（广播到所有窗口）
    CHANGED: 'theme:changed',            // 主题变化通知
    SYNC: 'theme:sync',                  // 同步主题到子窗口
  },
  SECURE_STORAGE: {
    ENCRYPT: 'secure-storage:encrypt',
    DECRYPT: 'secure-storage:decrypt',
    DELETE: 'secure-storage:delete',
    IS_AVAILABLE: 'secure-storage:isAvailable',
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

// 隐私模式常量
const PRIVACY_MODES = {
  STANDARD: 'standard',
  OFFLINE: 'offline',
  STRICT: 'strict',
};

// CommonJS 导出
module.exports = { CHANNELS, MENU_ACTIONS, PRIVACY_MODES };

// 为 Vite ESM 添加 default 导出
module.exports.default = module.exports;
