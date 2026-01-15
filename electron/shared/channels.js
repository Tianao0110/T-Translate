// electron/shared/channels.js
// IPC 通道常量表 - 消灭魔术字符串
// 前后端共用，确保通道名称一致

/**
 * IPC 通道命名规范:
 * - 使用 ':' 分隔命名空间和操作
 * - 格式: namespace:action 或 namespace:sub-namespace:action
 * - 例如: store:get, glass:capture-region
 */

const CHANNELS = {
  // ==================== 系统/窗口控制 ====================
  SYSTEM: {
    MINIMIZE: 'minimize-window',
    MAXIMIZE: 'maximize-window',
    CLOSE: 'close-window',
    SET_ALWAYS_ON_TOP: 'set-always-on-top',
    OPEN_EXTERNAL: 'open-external',
    GET_PLATFORM: 'get-platform',
    GET_APP_PATH: 'get-app-path',
  },

  // ==================== 对话框 ====================
  DIALOG: {
    SAVE: 'show-save-dialog',
    OPEN: 'show-open-dialog',
    MESSAGE: 'show-message-box',
  },

  // ==================== 存储 ====================
  STORE: {
    GET: 'store-get',
    SET: 'store-set',
    DELETE: 'store-delete',
    CLEAR: 'store-clear',
    HAS: 'store-has',
  },

  // ==================== 应用 ====================
  APP: {
    GET_VERSION: 'get-app-version',
    GET_PLATFORM: 'get-platform',
    HEALTH_CHECK: 'api:health-check',
  },

  // ==================== 隐私模式 ====================
  PRIVACY: {
    SET_MODE: 'privacy:setMode',
    GET_MODE: 'privacy:getMode',
  },

  // ==================== 快捷键 ====================
  SHORTCUTS: {
    GET: 'shortcuts:get',
    UPDATE: 'shortcuts:update',
    PAUSE: 'shortcuts:pause',
    RESUME: 'shortcuts:resume',
  },

  // ==================== 截图 ====================
  SCREENSHOT: {
    CAPTURE: 'capture-screen',
    SELECTION: 'screenshot-selection',
    CANCEL: 'screenshot-cancel',
    CAPTURED: 'screenshot-captured',       // 事件: 截图完成
    CONFIG: 'screenshot-config',           // 事件: 截图配置
    SCREEN_BOUNDS: 'screen-bounds',        // 事件: 屏幕边界
  },

  // ==================== 玻璃窗口 ====================
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
    // 事件
    REFRESH: 'glass:refresh',
    SETTINGS_CHANGED: 'glass:settings-changed',
    TRANSLATE_REQUEST: 'glass:translate-request',
  },

  // ==================== 字幕采集 ====================
  SUBTITLE: {
    TOGGLE_CAPTURE_WINDOW: 'subtitle:toggle-capture-window',
    GET_CAPTURE_RECT: 'subtitle:get-capture-rect',
    SET_CAPTURE_RECT: 'subtitle:set-capture-rect',
    CLEAR_CAPTURE_RECT: 'subtitle:clear-capture-rect',
    CAPTURE_REGION: 'subtitle:capture-region',
    IS_CAPTURE_WINDOW_VISIBLE: 'subtitle:is-capture-window-visible',
    // 事件
    CAPTURE_RECT_UPDATED: 'subtitle:capture-rect-updated',
  },

  // ==================== 划词翻译 ====================
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
    // 事件
    SHOW_TRIGGER: 'selection:show-trigger',
    STATE_CHANGED: 'selection-state-changed',
  },

  // ==================== 剪贴板 ====================
  CLIPBOARD: {
    WRITE_TEXT: 'clipboard:write-text',
    READ_TEXT: 'clipboard:read-text',
    READ_IMAGE: 'read-clipboard-image',
    // 兼容旧通道名（逐步迁移）
    WRITE_TEXT_LEGACY: 'write-clipboard-text',
    READ_TEXT_LEGACY: 'read-clipboard-text',
  },

  // ==================== OCR ====================
  OCR: {
    // 引擎检测
    CHECK_WINDOWS_OCR: 'ocr:check-windows-ocr',
    CHECK_PADDLE_OCR: 'ocr:check-paddle-ocr',
    CHECK_INSTALLED: 'ocr:check-installed',
    GET_AVAILABLE_ENGINES: 'ocr:get-available-engines',
    // 引擎管理
    DOWNLOAD_ENGINE: 'ocr:download-engine',
    REMOVE_ENGINE: 'ocr:remove-engine',
    DOWNLOAD_PROGRESS: 'ocr:download-progress',  // 事件
    // 识别
    WINDOWS_OCR: 'ocr:windows-ocr',
    PADDLE_OCR: 'ocr:paddle-ocr',
    OCRSPACE: 'ocr:ocrspace',
    GOOGLE_VISION: 'ocr:google-vision',
    AZURE_OCR: 'ocr:azure-ocr',
    BAIDU_OCR: 'ocr:baidu-ocr',
  },

  // ==================== 菜单操作 ====================
  MENU: {
    ACTION: 'menu-action',
    IMPORT_FILE: 'import-file',
  },

  // ==================== 收藏与历史 ====================
  DATA: {
    ADD_TO_FAVORITES: 'add-to-favorites',
    ADD_TO_HISTORY: 'add-to-history',
    SYNC_TARGET_LANGUAGE: 'sync-target-language',
  },

  // ==================== 安全存储 ====================
  SECURE_STORAGE: {
    ENCRYPT: 'secure-storage:encrypt',
    DECRYPT: 'secure-storage:decrypt',
    DELETE: 'secure-storage:delete',
    IS_AVAILABLE: 'secure-storage:isAvailable',
  },
};

// 菜单动作常量
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

// 隐私模式
const PRIVACY_MODES = {
  STANDARD: 'standard',
  OFFLINE: 'offline',
  STRICT: 'strict',
};

// OCR 引擎 ID
const OCR_ENGINES = {
  LLM_VISION: 'llm-vision',
  RAPID_OCR: 'rapid-ocr',
  PADDLE_OCR: 'paddle-ocr',
  WINDOWS_OCR: 'windows-ocr',
  OCRSPACE: 'ocrspace',
  GOOGLE_VISION: 'google-vision',
  AZURE_OCR: 'azure-ocr',
  BAIDU_OCR: 'baidu-ocr',
};

module.exports = {
  CHANNELS,
  MENU_ACTIONS,
  PRIVACY_MODES,
  OCR_ENGINES,
};
