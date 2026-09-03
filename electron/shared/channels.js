// IPC channel constants — kills magic strings.

const CHANNELS = {
  SYSTEM: {
    MINIMIZE: 'minimize-window',
    MAXIMIZE: 'maximize-window',
    CLOSE: 'close-window',
    SHOW: 'show-window',
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
  DOCUMENT: {
    // "Open with T-Translate" hand-off: renderer pulls the pending file (path
    // is main-process-owned — no arbitrary-path read surface), main pushes a
    // ready ping on second-instance.
    TAKE_PENDING_OPEN: 'document:take-pending-open',
    OPEN_FILE_READY: 'document:open-file-ready',
  },
  STORE: {
    GET: 'store-get',
    SET: 'store-set',
    DELETE: 'store-delete',
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
    // Fire-and-forget: renderer crashes never reached the log files, so a
    // React error or unhandled rejection left no trace on disk at all.
    WRITE: 'logs:write',
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
  // Encrypted-at-rest vault for the translation-store persist blob (history /
  // favorites / statistics). Main window only; DPAPI via safeStorage.
  HISTORY_VAULT: {
    STATUS: 'history-vault:status',
    LOAD: 'history-vault:load',
    SAVE: 'history-vault:save',
    CLEAR: 'history-vault:clear',
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
    READINESS: 'stack:readiness',                 // can anything translate right now?
    CURRENT_PROVIDER: 'stack:current-provider',
    RELOAD: 'stack:reload',
    CLEAR_CACHE: 'stack:clear-cache',
    CACHE_STATS: 'stack:cache-stats',
    CHANGED: 'stack:changed',                     // main → renderer: stack reloaded
    OCR_RECOGNIZE: 'stack:ocr-recognize',         // allowedEngines injected main-side
    OCR_RESET_VISION: 'stack:ocr-reset-vision',
    VISION_CHAT: 'stack:vision-chat',             // path B: prompt + capture to a vision model
    VISION_CAPABILITY: 'stack:vision-capability', // may path B run under the live privacy mode?
    // External TTS endpoint (OpenAI-compatible /v1/audio/speech), v0.4.2.
    // Offline mode refuses all three main-side; the key stays in the vault.
    TTS_CAPABILITY: 'stack:tts-capability',       // configured + allowed under the live privacy mode?
    TTS_SPEAK: 'stack:tts-speak',                 // {requestId, text, voice, speed} → {success, audio}
    TTS_TEST: 'stack:tts-test',                   // settings page: synthesize a sample with a draft config
  },
  // Listen-translate (audio engine). Hosted by the floating window's listen
  // mode; the mode entry is always visible but disabled until an ASR base
  // pack sits under userData/asr-models — packs install from settings, and
  // hand-placed model folders still count.
  AUDIO_ENGINE: {
    GET_INFO: 'audio-engine:get-info',   // renderer → main: model/privacy/state snapshot
    START: 'audio-engine:start',         // renderer → main: spawn ASR worker; payload {language, source}
    STOP: 'audio-engine:stop',           // renderer → main: stop worker
    SOURCES: 'audio-engine:sources',     // renderer → main: audio sources + capability probe
    STATUS: 'audio-engine:status',       // main → renderer: {state, detail}
    LEVEL: 'audio-engine:level',         // main → renderer: 0..1 capture level, ~12/s
    // v0.4.1 moved capture into the worker's native WASAPI layer, so the
    // renderer no longer produces PCM at all: the pcm/event channels it used
    // to push through are gone rather than left dangling.
    SEGMENT: 'audio-engine:segment',     // main → renderer: recognized (final) segment record
    PARTIAL: 'audio-engine:partial',     // main → renderer: open-segment provisional text ('' clears)
    EXPORT_SRT: 'audio-engine:export-srt', // renderer → main: save dialog + write subtitle file
    // Model packs (settings page owns the only download entry point)
    PACKS_LIST: 'audio-engine:packs-list',
    PACKS_DOWNLOAD: 'audio-engine:packs-download',
    PACKS_REMOVE: 'audio-engine:packs-remove',
    DOWNLOAD_PROGRESS: 'audio-engine:download-progress', // shared by ASR and voice packs (payload carries packId)
    // Neural TTS (v0.4.2): voice packs live under tts-models and synthesis
    // runs in the same worker. Audio streams back one sentence at a time.
    TTS_STATUS: 'audio-engine:tts-status',     // renderer → main: {available, packs, loaded}
    TTS_VOICES: 'audio-engine:tts-voices',     // renderer → main: installed voices (packId:sid)
    TTS_GENERATE: 'audio-engine:tts-generate', // renderer → main: {id, text, packId, sid, speed}
    TTS_CANCEL: 'audio-engine:tts-cancel',     // renderer → main: {id}
    TTS_CHUNK: 'audio-engine:tts-chunk',       // main → requesting window: {id, samples, sampleRate} | {id, done} | {id, error}
    TTS_PACKS_LIST: 'audio-engine:tts-packs-list',
    TTS_PACKS_DOWNLOAD: 'audio-engine:tts-packs-download',
    TTS_PACKS_REMOVE: 'audio-engine:tts-packs-remove',
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
