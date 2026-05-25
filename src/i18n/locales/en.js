// src/i18n/locales/en.js
// English language pack - split from i18n.js

const en = {
  app: { name: "T-Translate", version: "Version" },
  nav: { translate: "Translate", history: "History", favorites: "Favorites", documents: "Documents", settings: "Settings" },
  status: { ready: "Ready", today: "Today", online: "Online", offline: "Offline" },
  screenshot: { failed: "Screenshot failed" },
  notify: { unknownError: "Unknown error", networkError: "Network error" },
  settingsNav: {
    searchPlaceholder: "Search settings...",
    groupTranslation: "Translation", groupSystem: "System",
    providers: "Providers", translation: "Translation", selection: "Selection", glassWindow: "Glass Window", document: "Documents",
    ocr: "OCR", tts: "Text to Speech", interface: "Appearance", connection: "LM Studio", privacy: "Privacy", about: "About",
    export: "Export", import: "Import", reset: "Reset",
    simpleMode: "Simple", fullMode: "Full", switchToFull: "Full", switchToSimple: "Simple",
    noMatch: "No matching settings found",
    unsavedChanges: "Unsaved changes", saving: "Saving...", saveChanges: "Save Changes"
  },
  providerSettings: {
    title: "Translation Providers", description: "Configure translation services, supporting local models and online APIs",
    priorityHint: "Translate in priority order, first successful one will be used. Drag cards to adjust order.",
    configDetails: "Configuration", testConnection: "Test Connection",
    testing: "Testing...", connected: "Connected", connectionFailed: "Connection failed", notTested: "Not tested",
    noConfig: "This provider requires no configuration, ready to use",
    saved: "Provider settings saved", saveFailed: "Save failed",
    enabledSection: "Enabled", disabledSection: "Not Enabled",
    noEnabled: "No translation providers enabled",
    enable: "Enable",
    getApiKey: "Get API Key",
    typeLabels: { llm: "AI Model", api: "Pro API", traditional: "Traditional" },
    names: {
      'local-llm': 'LM Studio (Local)',
      'openai': 'OpenAI',
      'deepl': 'DeepL',
      'gemini': 'Google Gemini',
      'deepseek': 'DeepSeek',
      'google-translate': 'Google Translate',
      'ollama': 'Ollama (Local)',
      'anthropic': 'Anthropic Claude',
      'microsoft-translator': 'Microsoft Translator',
      'baidu-translate': 'Baidu Translate'
    },
    descriptions: {
      'local-llm': 'Local LLM translation, private and free',
      'openai': 'GPT models, high quality and fast',
      'deepl': 'Professional translation API, excellent quality',
      'gemini': 'Google AI model, free tier available, high quality',
      'deepseek': 'DeepSeek AI model, affordable, excellent for Chinese',
      'google-translate': 'Free to use, supports many languages, fast',
      'ollama': 'Local LLM via Ollama, private and free',
      'anthropic': 'Claude AI model, extremely high translation quality',
      'microsoft-translator': 'Microsoft Translator API, 2M chars/month free',
      'baidu-translate': 'Baidu Translate API, direct access in China, free tier'
    }
  },
  providerConfig: {
    'local-llm': { endpoint: 'API Endpoint', model: 'Model Name', timeout: 'Timeout (ms)', model_placeholder: 'Leave empty to auto-detect' },
    'openai': { apiKey: 'API Key', endpoint: 'API Endpoint', model: 'Model Name' },
    'deepl': { apiKey: 'API Key', freeApi: 'Use Free API (Key ending with :fx)' },
    'gemini': { apiKey: 'API Key', model: 'Model' },
    'deepseek': { apiKey: 'API Key', model: 'Model', endpoint: 'API Endpoint' },
    'google-translate': { domain: 'Server', domain_com: 'google.com (International)', domain_cn: 'google.cn (China)', 'domain_com.hk': 'google.com.hk (Hong Kong)' },
    'ollama': { endpoint: 'API Endpoint', model: 'Model Name', timeout: 'Timeout (ms)', model_placeholder: 'Leave empty to auto-detect (e.g. llama3, qwen2)' },
    'anthropic': { apiKey: 'API Key', model: 'Model', baseUrl: 'API Endpoint' },
    'microsoft-translator': { apiKey: 'API Key', region: 'Region' },
    'baidu-translate': { appId: 'APP ID', secretKey: 'Secret Key' },
    ocr: { language: 'Recognition Language', language_chs: 'Simplified Chinese', language_cht: 'Traditional Chinese', language_eng: 'English', language_jpn: 'Japanese', language_kor: 'Korean' }
  },
  translationSettings: {
    title: "Translation Settings", description: "Configure translation behavior and output",
    autoTranslate: "Auto Translate", autoTranslateHint: "Start translation automatically after input stops",
    autoDelay: "Auto Translate Delay", autoDelayHint: "How long to wait after input stops",
    streamOutput: "Stream Output (Typewriter effect)", streamOutputHint: "Results will appear character by character",
    cache: "Translation Cache", cacheHint: "Cache translated content, return cached results for same text",
    clearCache: "Clear Cache", clearCacheConfirm: "Are you sure to clear translation cache?", cacheCleared: "Cache cleared"
  },
  documentSettings: {
    title: "Document Translation", description: "Configure segmentation, filter rules and display style",
    segmentSettings: "Segmentation", maxCharsPerSegment: "Max chars per segment", segmentHint: "Long paragraphs will be split automatically",
    batchTranslation: "Batch Translation", batchMaxTokens: "Max tokens per batch", batchMaxSegments: "Max segments per batch",
    batchHint: "Merging short paragraphs reduces API calls",
    smartFilter: "Smart Filter", skipShort: "Skip short paragraphs", minLength: "Min length",
    skipNumbers: "Skip number-only paragraphs (e.g. page numbers)", skipCode: "Keep code blocks untranslated", skipTargetLang: "Skip paragraphs already in target language",
    displayStyle: "Default Display Style",
    styleBelow: "Top-bottom - Translation below source", styleSideBySide: "Side by side - Source and translation side by side",
    styleSourceOnly: "Source only - Hide translation", styleTranslatedOnly: "Translation only - Hide source",
    supportedFormats: "Supported Formats", formatHint: "Supports encrypted PDFs · Auto chapter detection · Translation memory"
  },
  shortcuts: {
    title: "Shortcuts",
    translate: "Translate", swapLanguages: "Swap Languages", clear: "Clear", paste: "Paste", copy: "Copy Result",
    screenshot: "Screenshot", toggleWindow: "Show/Hide Window", glassWindow: "Glass Window", selectionTranslate: "Toggle Selection",
    hint: "Click to edit shortcut, press Esc to cancel. 🌐 marks global shortcuts",
    pressKey: "Press shortcut...", resetDefault: "Reset to Default",
    updated: "Shortcut updated: {{label}} → {{shortcut}}", updateFailed: "Shortcut update failed: {{error}}", reset: "Shortcuts reset to default",
    conflictNotice: "Shortcuts occupied by other apps: {{shortcuts}}. You can change them in Settings."
  },
  toolbar: { glass: "Glass Window", screenshot: "Screenshot", selection: "Selection", selectionOn: "Selection ON", selectionOff: "Selection OFF", privacy: "Privacy Mode", theme: "Theme" },
  templates: { natural: "Natural", naturalDesc: "Daily/Casual", precise: "Precise", preciseDesc: "Tech/Academic", formal: "Formal", formalDesc: "Business/Official" },
  translation: {
    sourceLang: "Source", targetLang: "Target", auto: "Auto Detect",
    inputPlaceholder: "Enter text to translate...", outputPlaceholder: "Translation will appear here",
    translate: "Translate", translating: "Translating...", copy: "Copy", copied: "Copied", clear: "Clear",
    swap: "Swap Languages", speak: "Speak", stop: "Stop", favorite: "Favorite", favorited: "Favorited", characters: "characters",
    source: "Source", target: "Target", recognizing: "Recognizing...",
    screenshot: "Screenshot OCR", importImage: "Import Image", paste: "Paste",
    speakSource: "Speak Source", speakTarget: "Speak Target", stopSpeak: "Stop Speaking",
    ocrProcessing: "Recognizing text from image...", dropFile: "Drop file to import...",
    noTextToSpeak: "No text to speak", speakFailed: "Speech failed",
    ocrRecognizing: "Recognizing text...", ocrSuccess: "Recognition successful ({{engine}})", ocrFailed: "No text recognized",
    enterText: "Please enter text to translate", notConnected: "LM Studio not connected, check connection or use offline mode",
    translateFirst: "Please translate first", selectStyle: "Please select a reference style",
    styleRewriteComplete: "Style rewrite complete", styleRewriteFailed: "Style rewrite failed",
    savedToStyle: "Saved to style library", saved: "Saved",
    imageOcrRecognizing: "Recognizing image text...", imageOcrSuccess: "Text recognition successful",
    fileImportSuccess: "File imported successfully", unsupportedFileType: "Unsupported file type",
    recognizingClipboard: "Found clipboard image, recognizing...",
    autoReplaced: "Auto replaced: {{info}}", copiedForManualReplace: "Copied \"{{text}}\", please replace manually in target",
    termSet: "Term set",
    glossaryApplied: "Glossary auto-replaced",
    glossaryItems: "items",
    glossaryUndone: "Glossary replacement undone",
    undo: "Undo",
    styleRewrite: "Style Rewrite",
    termFound: "Replaceable terms found",
    applyTerm: "Apply this translation", apply: "Apply",
    ignoreTerm: "Ignore this time",
    neverRemind: "Don't remind again",
    alwaysUseTerm: "Always use this term", always: "Always",
    selectStyle: "Select Reference Style", fromStyleLib: "Choose from Style Library",
    styleLibEmpty: "Style library is empty", styleLibHint: "Check \"Mark as style reference\" when saving to add to style library",
    styleStrength: "Style Strength", strengthLight: "Light", strengthFull: "Full imitation",
    strengthDescLight: "Light adjustment, mostly keeping original style",
    strengthDescMedium: "Moderate imitation of reference style",
    strengthDescHigh: "Heavy imitation, closely matching reference tone and expression",
    startRewrite: "Start Rewrite",
    addToFavorites: "Add to Favorites", aiSuggestions: "AI Suggestions", reanalyze: "Reanalyze",
    aiAnalyzing: "AI is analyzing content...", summaryNote: "Summary/Note", shortDesc: "Short description...",
    aiRecommended: "AI Recommended",
    saveToStyleLib: "Will be saved to Style Library for style rewriting", saveAsNormal: "Save as regular favorite",
    saveToStyleLibBtn: "Save to Style Library", saveFavorite: "Save Favorite",
    analysisFailed: "Analysis failed",
    rewriteFailed: "Rewrite failed",
    versionOriginal: "Original", versionOriginalFull: "Original Translation",
    versionStyleRewrite: "Style Rewrite", versionUserEdit: "User Edit", versionUnknown: "Unknown"
  },
  languages: { auto: "Auto Detect", zh: "Chinese", "zh-TW": "Traditional Chinese", en: "English", ja: "Japanese", ko: "Korean", fr: "French", de: "German", es: "Spanish", ru: "Russian", pt: "Portuguese", it: "Italian", ar: "Arabic", th: "Thai", vi: "Vietnamese", pa: "Punjabi" },
  history: { 
    title: "Translation History", search: "Search history...", empty: "No history yet", clearAll: "Clear", clearConfirm: "Are you sure to clear all history?", 
    delete: "Delete", restore: "Restore to Edit", today: "Today", yesterday: "Yesterday", thisWeek: "This Week", thisMonth: "This Month", earlier: "Earlier",
    view: { card: "Card", table: "Table" },
    filter: { all: "All Time", today: "Today", week: "This Week", month: "This Month" },
    group: { date: "By Date", language: "By Language" },
    select: "Select", export: "Export", import: "Import",
    deleteSelected: "Delete ({{count}})",
    searchResult: "Search \"{{keyword}}\" found {{count}} results",
    searchHint: "(↑↓ Navigate, Enter to copy)",
    loadMore: "Load More ({{count}})",
    showing: "Showing {{current}} / {{total}}",
    selectedHint: "Selected {{count}} | Space to select, Esc to exit",
    copySource: "Copy Source", copyTarget: "Copy Target", favorite: "Favorite", unfavorite: "Unfavorite",
    copied: "Copied", restored: "Restored to editor", favorited: "Added to favorites", unfavorited: "Removed from favorites",
    exportSuccess: "Export successful", exportFailed: "Export failed", cleared: "Cleared",
    importedCount: "Imported {{count}} records", importFailed: "Import failed", noMatch: "No matching records found",
    emptyHint: "Translations will be saved here automatically",
    deleteSelectedConfirm: "Delete {{count}} selected records?",
    deletedCount: "Deleted {{count}} records",
    clearAllConfirm: "Clear all {{count}} records?",
    secureMode: { title: "Incognito Mode Enabled", desc: "History won't be saved in this mode. Switch to Standard mode to save history." },
    stats: { 
      title: "Statistics", total: "Total Records", today: "Today", thisWeek: "This Week", 
      totalChars: "Total Characters", avgLength: "Average Length", streak: "Streak Days", languagePairs: "Language Pairs" 
    },
    table: { time: "Time", language: "Language", source: "Source", target: "Target", actions: "Actions" },
    card: { clickHint: "Click to toggle source/target, double-click for details", source: "Source", target: "Target" }
  },
  favorites: { 
    title: "Favorites", search: "Search favorites...", empty: "No favorites yet", noMatch: "No matching favorites found", 
    emptyHint: "Click the star icon in translation results to add favorites",
    clearAll: "Clear All", delete: "Delete", tags: "Tags", addTag: "Add Tag", noTags: "No Tags",
    newFolder: "New Folder", folderName: "Folder Name", create: "Create",
    allFavorites: "All Favorites", uncategorized: "Uncategorized",
    folders: { work: "Work", study: "Study", life: "Life", glossary: "Glossary", styleLibrary: "Style Library" },
    importTerms: "Import Terms", exportTerms: "Export Terms",
    terms: "terms", items: "items", note: "Note", actions: "Actions",
    addNote: "Add note...", save: "Save", cancel: "Cancel", edit: "Edit", copy: "Copy",
    movedToStyle: "Moved to Style Library", movedFromStyle: "Removed from Style Library", deleted: "Deleted", copied: "Copied",
    deleteConfirm: "Are you sure to delete this favorite?", termUpdated: "Term updated",
    aiTagSuccess: "AI tags generated", aiTagFailed: "AI tag generation failed",
    aiGenerateTags: "AI generate tags", aiGenerate: "AI Generate", generating: "Generating...",
    markAsStyle: "Mark as style reference", willMoveToStyle: "Will move to Style Library", normalFavorite: "Normal favorite",
    moveTo: "Move to", moveToFolder: "Move to folder", copyTarget: "Copy translation", editTagsNotes: "Edit tags and notes",
    glossaryEmpty: "Glossary is empty", folderDeleted: "Folder deleted", folderCreated: "Folder created",
    deleteFolderConfirm: "Delete folder? Items will be moved to \"Uncategorized\"",
    moved: "Moved", noValidTerms: "No valid terms found",
    exportedTerms: "Exported {{count}} terms ({{format}})",
    importedTerms: "Imported {{count}} terms", importSkipped: " (skipped {{skipped}} duplicates)",
    importFailed: "Import failed",
    tagsLabel: "Tags (comma separated)", tagsPlaceholder: "formal, academic, important...",
    noteLabel: "Note", notePlaceholder: "Add note..."
  },
  connectionSettings: {
    title: "LM Studio Connection", endpoint: "API Endpoint", timeout: "Timeout (ms)",
    testing: "Testing...", testConnection: "Test Connection", availableModels: "Available Models",
    connectionSuccess: "Connected! Found {{count}} models", connectionFailed: "Connection failed", connectionError: "Connection error"
  },
  documents: { title: "Document Translation", upload: "Upload Document", dragDrop: "Drag & drop file here, or click to upload", supported: "Supports PDF, DOCX, EPUB, TXT", translating: "Translating...", download: "Download", preview: "Preview" },
  privacy: {
    modeDescription: "Choose a mode that fits your needs. Different features are available in different modes.",
    currentMode: "Current Mode",
    featuresTitle: "Current Mode Features",
    switchedTo: "Switched to {{mode}}",
    modes: {
      standard: "Standard", standardDesc: "Full features, auto-save history",
      incognito: "Incognito", incognitoDesc: "No records saved, cleared on close",
      offline: "Offline", offlineDesc: "Fully offline, no network requests",
      strict: "Strict", strictDesc: "Maximum privacy, local processing only"
    },
    clearHistoryConfirm: "Are you sure to clear all translation history?",
    historyCleared: "History cleared",
    clearAllConfirm: "Are you sure to clear all local data? This will reset all settings.",
    features: { history: "History", cache: "Translation Cache", onlineApi: "Online Translation API", analytics: "Usage Analytics" },
    save: "Save", noSave: "No Save", allow: "Allow", deny: "Deny", collect: "Collect", noCollect: "No Collect",
    offlineWarning: "In offline mode, only local LLM translation is available. Online sources (OpenAI, DeepL, etc.) are disabled.",
    incognitoWarning: "Incognito mode is on: Translation history is paused. Previous history will be restored when you exit.",
    dataManagement: "Data Management",
    autoDeleteHistory: "Auto-delete history after",
    daysLater: "days",
    zeroMeansNever: "Set to 0 to never auto-delete",
    incognitoDisabled: " (Disabled in incognito mode)"
  },
  glass: { 
    title: "Glass Window", pin: "Pin", unpin: "Unpin", opacity: "Opacity", close: "Close", addPanel: "Add Panel", removePanel: "Remove Panel", clearAll: "Clear All",
    description: "Configure floating translation window behavior and appearance",
    lockTargetLang: "Lock Target Language", lockTargetLangOnDesc: "Always translate to target language", lockTargetLangOffDesc: "Auto switch based on source (may cause back-translation)", lockTargetLangHint: "Recommended to enable to avoid language switching",
    smartDetect: "Smart Detect", smartDetectOnDesc: "Auto skip unchanged content", smartDetectOffDesc: "Re-recognize and translate every time",
    ocrEngine: "OCR Engine", useGlobalOcr: "Using global OCR settings (Current: {{engine}})", goToSettings: "Go to Settings",
    defaultOpacity: "Default Opacity", opacityHint: "Click the bar in glass window to adjust in real-time",
    windowOptions: "Window Options", rememberPosition: "Remember Position", autoPin: "Always on Top",
    shortcut: { toggle: "Toggle Glass Window", capture: "Manual Screenshot", exit: "Exit Subtitle Mode / Close" },
    instructions: "Instructions",
    normalMode: "Normal Mode", normalModeDesc: "Click 📷 to capture current area",
    subtitleMode: "Subtitle Mode", subtitleModeDesc: "Click 🎬 to enable real-time subtitle translation",
    firstUse: "First Use Subtitle Mode", firstUseDesc: "Need to select subtitle area first",
    // Glass window component strings
    captureSpace: "Screenshot (Space)", historyCtrlH: "History (Ctrl+H)",
    adjustOpacity: "Adjust opacity", closeEsc: "Close (Esc)",
    capturing: "Capturing...", recognizing: "Recognizing...", translating: "Translating...",
    captureHint: "Click 📷 or press Space to capture",
    doubleClickFreeze: "Double-click to pin as independent window",
    passThroughMode: "Pass-through mode (release Alt to exit)",
    goToOcrSettings: "Go to OCR Settings"
  },
  selection: {
    freeze: "Freeze", unfreeze: "Unfreeze", close: "Close", copy: "Copy", more: "More",
    description: "Show translate button after selecting text",
    enableSelection: "Enable Selection Translation", enabled: "Selection translation enabled", disabled: "Selection translation disabled",
    enabledDesc: "Show translate button after selecting text", disabledDesc: "Selection translation disabled", toggleFailed: "Failed to toggle selection translation",
    shortcutHint: "You can also use {{shortcut}} to toggle",
    triggerTimeout: "Button Auto-hide Time", seconds: "s", triggerTimeoutHint: "Time before translate button auto-hides",
    showSourceByDefault: "Show Source by Default", showSourceOnDesc: "Show source text comparison by default", showSourceOffDesc: "Only show translation",
    autoCloseOnCopy: "Auto Close on Copy", autoCloseOnDesc: "Auto close window after copying", autoCloseOffDesc: "Keep window open after copying",
    // CapsLock sticky direct mode
    stickyCapsLockLabel: "CapsLock Direct Mode",
    stickyCapsLockDesc: "Use CapsLock as sticky direct-translate mode",
    stickyWarningTitle: "Enable CapsLock Direct Mode?",
    stickyWarningBody: "Once enabled, any text you select while the CapsLock LED is on will translate immediately (skipping the intermediate icon step).\n\nThis setting does NOT change CapsLock's normal 'type in uppercase' behavior. When you're typing normally (e.g. writing an email), just turn CapsLock off and the usual selection flow resumes.",
    stickyWarningConfirm: "Got it, enable",
    windowOpacity: "Window Opacity", opacityHint: "Adjust selection translation window opacity",
    screenshotOutput: "Screenshot Output", bubble: "Bubble Window", mainWindow: "Main Window",
    bubbleDesc: "Show result in floating bubble", mainWindowDesc: "Show result in main window", outputHint: "In bubble mode, process in background and popup when done",
    charLimit: "Character Limit", minChars: "Min", maxChars: "Max", charLimitHint: "Content below min or above max characters won't trigger translation",
    instructions: "Instructions", workflow: "Workflow",
    step1: "Select text with mouse", step2: "Translate button appears nearby", step3: "Click button to translate", step4: "Result card shows after translation",
    quickActions: "Quick Actions", action1: "Drag title bar to move", action2: "Resize from bottom-right corner", action3: "Click 'Source' to show comparison", action4: "Click 'Copy' or select text to copy", action5: "Press ESC or right-click to close",
    // Selection translator component strings
    translateFailed: "Translation failed",
    noText: "No text captured",
    emptyContent: "Selection is empty",
    tooShort: "Text too short (minimum {{min}} characters)",
    tooLong: "Text too long (maximum {{max}} characters)",
    noValidText: "Selection contains no valid text",
    possibleGarbage: "Selection may be garbled text",
    isFilePath: "Selection is a file path",
    emptyResult: "Translation result is empty",
    frozenHint: "Pinned - right-click to close",
    showSource: "Show source",
    copyTarget: "Copy translation",
    closeEsc: "Close (ESC)"
  },
  settings: {
    title: "Settings",
    saved: "Settings saved", saveFailed: "Failed to save settings",
    exported: "Settings exported", invalidFormat: "Invalid settings file format", importedPleasesSave: "Settings imported, please save to apply", invalidFile: "Invalid settings file",
    resetSectionConfirm: "Reset \"{{section}}\" settings?", resetAllConfirm: "Reset all settings? This will clear all custom configurations.",
    sectionReset: "{{section}} settings reset", sectionNotFound: "Default settings for {{section}} not found", allReset: "All settings reset",
    tabs: { general: "General", providers: "Providers", ocr: "OCR", shortcuts: "Shortcuts", privacy: "Privacy", tts: "TTS", glossary: "Glossary", about: "About" },
    general: {
      title: "General Settings", language: "Language", languageDesc: "Select interface language",
      theme: "Theme", themeDesc: "Select app appearance",
      themes: { default: "Default", fresh: "Fresh", dark: "Dark" },
      startup: "Start on Boot", startupDesc: "Run automatically on system startup", minimize: "Minimize to Tray", minimizeDesc: "Minimize to system tray when closed",
      defaultSource: "Default Source Language", defaultTarget: "Default Target Language",
      langSwitched: "Language changed"
    },
    startup: {
      title: "Startup",
      autoLaunch: "Launch at startup",
      autoLaunchHint: "Automatically run in the background when the system starts",
      autoLaunchEnabled: "Auto-launch enabled",
      autoLaunchDisabled: "Auto-launch disabled",
      autoLaunchFailed: "Failed to set auto-launch",
      autoSelection: "Enable selection translate on startup",
      autoSelectionHint: "Automatically enable selection translate after auto-launch",
    },
    providers: {
      title: "Translation Providers", enable: "Enable", disable: "Disable", test: "Test Connection", testing: "Testing...", testSuccess: "Connection successful", testFailed: "Connection failed",
      priority: "Priority", priorityDesc: "Drag to adjust provider priority", apiKey: "API Key", apiKeyPlaceholder: "Enter API Key", baseUrl: "API URL", model: "Model", getKey: "Get Key",
      localLlm: { name: "Local LLM", desc: "Use local models, fully offline", endpoint: "API Endpoint", endpointPlaceholder: "http://localhost:1234/v1" },
      openai: { name: "OpenAI", desc: "Translate with GPT models" }, deepl: { name: "DeepL", desc: "High quality translation" },
      gemini: { name: "Gemini", desc: "Google AI translation" }, deepseek: { name: "DeepSeek", desc: "DeepSeek AI translation" }, google: { name: "Google Translate", desc: "Free Google translation" }
    },
    ocr: { title: "OCR Settings", engine: "OCR Engine", engineDesc: "Select text recognition engine", engines: { rapid: "RapidOCR (Local)", windows: "Windows OCR", llmVision: "LLM Vision" }, language: "Recognition Language", languageDesc: "Select language to recognize" },
    shortcuts: { title: "Keyboard Shortcuts", desc: "Customize global shortcuts", showWindow: "Show/Hide Window", screenshot: "Screenshot Translate", glassWindow: "Glass Window", selectionToggle: "Toggle Selection", recording: "Press shortcut...", conflict: "Shortcut conflict", reset: "Reset Default" },
    privacy: {
      title: "Privacy Settings", mode: "Privacy Mode", modeDesc: "Control data storage and network",
      modes: { standard: "Standard", standardDesc: "Normal features, save history", offline: "Offline", offlineDesc: "Local translation only", incognito: "Incognito", incognitoDesc: "No history or cache", strict: "Strict", strictDesc: "Offline + Incognito" },
      clearHistory: "Clear History", clearCache: "Clear Cache", clearAll: "Clear All Data"
    },
    tts: { title: "Text-to-Speech", enable: "Enable TTS", enableDesc: "Enable voice reading", voice: "Voice", voiceDesc: "Select voice", rate: "Speed", rateDesc: "Adjust reading speed", pitch: "Pitch", pitchDesc: "Adjust voice pitch", volume: "Volume", volumeDesc: "Adjust volume", test: "Test", testText: "This is a test message" },
    glossary: { title: "Glossary", desc: "Custom translation terms for consistent terminology", add: "Add Term", source: "Source", target: "Translation", empty: "No terms yet", import: "Import", export: "Export", delete: "Delete", save: "Save" },
    about: { title: "About", version: "Version", checkUpdate: "Check for Updates", checking: "Checking...", upToDate: "You're up to date", newVersion: "New version available", download: "Download", later: "Later", releaseNotes: "Release Notes", publishedAt: "Published", github: "GitHub", feedback: "Feedback", license: "License", copyright: "© 2026 T-Translate" },
    selection: { title: "Selection Translate" },
    glass: { title: "Glass Window" }
  },
  about: {
    desc: "Smart Offline Translation Tool",
    features: "Core Features",
    feature1: "Local LLM translation, data stays on device",
    feature2: "Multi-engine OCR text recognition",
    feature3: "PDF/DOCX/EPUB document translation",
    feature4: "Selection translate + Glass window",
    techStack: "Tech Stack",
    openLogs: "Open Log Directory",
    logDirOpened: "Log directory opened",
    logDirFailed: "Cannot open log directory",
    updateUnavailable: "Update check unavailable",
    updateFailed: "Update check failed",
    noReleases: "No releases yet, you're up to date",
    currentVersion: "Current Version",
    latestVersion: "Latest Version",
    downloading: "Downloading...",
    downloadReady: "Download complete, ready to install",
    downloadComplete: "Download Complete",
    installHint: "Click the button below to launch the installer and close the app",
    launching: "Launching installer...",
    installNow: "Install Now",
    installFailed: "Installation failed",
    manualDownload: "Manual Download",
    downloadInstall: "Download & Install",
    githubHint: "You can also download manually from GitHub"
  },
  notify: { 
    success: "Success", error: "Error", warning: "Warning", info: "Info", 
    copySuccess: "Copied to clipboard", copyFailed: "Copy failed", 
    saveSuccess: "Saved successfully", saveFailed: "Save failed", 
    networkError: "Network error", translateError: "Translation failed", ocrError: "Recognition failed", 
    shortcutRegistered: "Shortcut registered", shortcutConflict: "Shortcut conflict"
  },
  guide: {
    subtitle: "Discover core features",
    dismiss: "Don't show again",
    selection: { title: "Selection Translate", desc: "Select any text to translate instantly" },
    screenshot: { title: "Screenshot Translate", desc: "Capture a screen region for OCR and translation" },
    glass: { title: "Glass Window", desc: "Transparent overlay that translates text in real-time" },
    document: { title: "Document Translate", desc: "Drop a file to translate paragraph by paragraph" },
  },
  security: {
    suspiciousAccess: "⚠️ Security Alert: Suspicious key access detected ({{count}} operations, {{keys}} unique keys). If this was not you, change all API Keys immediately.",
    encryptionUnavailable: "System encryption unavailable. API Keys cannot be stored securely.",
  },
  common: { confirm: "Confirm", cancel: "Cancel", save: "Save", delete: "Delete", edit: "Edit", close: "Close", open: "Open", enable: "Enable", disable: "Disable", loading: "Loading...", noData: "No data", retry: "Retry", reset: "Reset", search: "Search", filter: "Filter", all: "All", none: "None", yes: "Yes", no: "No", show: "Show", hide: "Hide", on: "On", off: "Off" },
  ocr: {
    description: "Configure text recognition engine and language",
    recognitionLanguage: "Recognition Language",
    lang: { auto: "Auto Detect", zhHans: "Simplified Chinese", zhHant: "Traditional Chinese", en: "English", ja: "Japanese", ko: "Korean", fr: "French", de: "German", es: "Spanish", ru: "Russian" },
    autoLangHint: "When set to Auto Detect, language will be selected based on translation settings",
    showConfirmButtons: "Show Screenshot Confirm Buttons", confirmButtonsHint: "When enabled, you need to click confirm or press Enter after selecting area",
    autoEnlarge: "Auto Enlarge Small Images", enlargeHint: "Small fonts (<15px) have low recognition rate, auto enlarge can improve accuracy",
    scaleFactor: "Scale Factor", recommended: "(Recommended)",
    localEngines: "Local OCR Engines", localHint: "Millisecond response, recommended",
    visionModels: "Vision Models", visionHint: "Deep recognition for complex scenarios",
    onlineServices: "Online OCR Services", onlineHint: "Accurate mode, requires network",
    onlineNote: "Commercial APIs have the most training data and highest accuracy. Auto disabled in privacy mode.",
    installed: "Installed", needDownload: "Need download ~60MB", builtin: "Built-in",
    rapidDesc: "Based on PP-OCRv4, 98%+ accuracy, fastest speed",
    llmVisionDesc: "Handle artistic text, handwriting, blurry text, comic bubbles, etc.",
    llmVisionMeta: "Requires LM Studio + Vision model (e.g., Qwen-VL)",
    free25k: "Free 25000/month", free5k: "Free 5000/month", free1k: "Free 1000/month",
    ocrspaceDesc: "Highest free quota, supports 25+ languages",
    googleVisionDesc: "Best recognition, supports 200+ languages",
    azureDesc: "Microsoft Cognitive Services, strong handwriting recognition",
    azureEndpoint: "Endpoint (e.g., https://xxx.cognitiveservices.azure.com)",
    baiduOcr: "Baidu OCR", baiduDesc: "Strong Chinese recognition, supports ID cards, bank cards, etc.",
    use: "Use", inUse: "✓ In Use", download: "Download", uninstall: "Uninstall",
    downloading: "Downloading RapidOCR...", downloadComplete: "Download complete! Recommend restart", downloadFailed: "Download failed",
    uninstallConfirm: "Are you sure to uninstall RapidOCR?", uninstalling: "Uninstalling...", uninstalled: "Uninstalled", uninstallFailed: "Uninstall failed",
    configKeyFirst: "Please configure API Key first", configKeyEndpoint: "Please configure API Key and Endpoint", configKeySecret: "Please configure API Key and Secret Key",
    llmVision: {
      notSupported: "Current model does not support image recognition. Please load a vision model (e.g., Qwen-VL, LLaVA)",
      noText: "No text recognized",
      timeout: "OCR recognition timed out. Please check if the model supports vision."
    },
    visionFallback: "Current model does not support vision. Automatically switched to local OCR.",
    visionLocked: "LLM Vision has been disabled due to repeated failures. Switched to local OCR. Re-enable in Settings > OCR.",
    allEnginesFailed: "All OCR engines failed"
  },
  tts: {
    description: "Configure text-to-speech settings",
    enableTTS: "Enable Text-to-Speech", enableHint: "Show speak button in translation panel",
    defaultVoice: "Default Voice", autoSelect: "Auto Select", refreshVoices: "Refresh Voices",
    voicesLoaded: "{{count}} voices available", autoSelectHint: "Auto select voice based on text language",
    rate: "Rate", rateHint: "Adjust speaking speed, 1.0 is normal",
    pitch: "Pitch", pitchHint: "Adjust voice pitch, 1.0 is normal",
    volume: "Volume", volumeHint: "Adjust volume level",
    preview: "Preview", previewHint: "Play test audio with current settings",
    play: "Play Preview", stop: "Stop",
    testTextMixed: "This is a TTS test. 这是语音朗读测试。",
    testTextChinese: "Hello, this is a TTS test.",
    testFailed: "Preview failed", loadVoicesFailed: "Failed to load voices",
    langNames: { zh: "Chinese", en: "English", ja: "Japanese", ko: "Korean", fr: "French", de: "German", es: "Spanish", ru: "Russian", pt: "Portuguese", it: "Italian" },
    noVoicesInstalled: "No voice packs installed. Please install voices in system settings.",
    noVoiceForLang: "No {{lang}} voice pack installed"
  },
  // ========== New: DocumentTranslator translation keys ==========
  documentTranslator: {
    title: "Document Translation",
    sourceLang: "Source Language",
    targetLang: "Target Language",
    newDocument: "Clear",
    formats: {
      "纯文本": "Plain Text", "Markdown": "Markdown", "SRT 字幕": "SRT Subtitle", "WebVTT 字幕": "WebVTT Subtitle",
      "PDF 文档": "PDF Document", "Word 文档": "Word Document", "CSV 表格": "CSV Spreadsheet", "JSON 文件": "JSON File", "EPUB 电子书": "EPUB eBook"
    },
    // Search & Replace
    search: {
      title: "Search",
      searchPlaceholder: "Search segments...",
      replacePlaceholder: "Replace with...",
      replaceAll: "Replace All",
      replaceThis: "Replace",
      matches: "matches",
      prev: "Previous",
      next: "Next"
    },
    // Segment
    segment: {
      edited: "Translation modified",
      retranslate: "Retranslate",
      edit: "Edit translation",
      copy: "Copy translation",
      save: "Save",
      cancel: "Cancel"
    },
    // Progress restore
    restore: {
      found: "Previous progress found ({{count}} translated)",
      restore: "Restore",
      dismiss: "Dismiss"
    },
    // Display styles
    displayStyles: {
      below: "Top-bottom",
      sideBySide: "Side by side",
      sourceOnly: "Source only",
      translatedOnly: "Translation only"
    },
    // Segment status
    status: {
      translating: "Translating...",
      pending: "Waiting",
      failed: "Translation failed"
    },
    // Actions
    actions: {
      retry: "Retry",
      export: "Export",
      startTranslation: "Start Translation",
      pause: "Pause",
      resume: "Resume",
      stop: "Stop",
      retryFailed: "Retry Failed ({{count}})"
    },
    // Upload area
    upload: {
      dropHere: "Drop file here",
      orClick: "or click to select",
      supported: "Supported: {{formats}}",
      parsing: "Parsing file..."
    },
    // Password modal
    password: {
      title: "File is encrypted",
      desc: "File <strong>{{filename}}</strong> requires a password to open",
      placeholder: "Enter password",
      cancel: "Cancel",
      confirm: "Confirm",
      wrongPassword: "Wrong password, please try again"
    },
    // Notifications
    notify: {
      fileLoaded: "File loaded: {{count}} segments",
      fileLoadedWithPages: "File loaded: {{count}} segments ({{pages}} pages)",
      parseFailed: "Failed to parse file",
      translationComplete: "Translation complete",
      translationCompleteFromCache: "Translation complete (all from cache)",
      retrySuccess: "Retry successful",
      retryFailed: "Retry failed: {{error}}",
      exportSuccess: "Export successful",
      exportFailed: "Export failed: {{error}}",
      printToPdf: "Please select \"Save as PDF\" in the print dialog",
      cacheCleared: "Translation memory cache cleared",
      scannedNoOcr: "This PDF is scanned (image-based). Please configure an OCR engine in Settings and try again.",
      ocrUsed: "OCR recognized",
      fileTooLarge: "File too large, max 20MB supported",
      pdfHint: "PDF: text content only. Images and complex layouts may be lost."
    },
    // Export menu
    export: {
      textFormat: "Text Format",
      bilingualTxt: "Bilingual TXT",
      bilingualMd: "Bilingual Markdown",
      translatedOnlyTxt: "Translation Only TXT",
      docFormat: "Document Format",
      bilingualWord: "Bilingual Word (.doc)",
      translatedOnlyWord: "Translation Only Word (.doc)",
      exportPdf: "Export PDF (Print)",
      subtitleFormat: "Subtitle Format",
      srtSubtitle: "SRT Subtitle",
      vttSubtitle: "VTT Subtitle"
    },
    // Stats
    stats: {
      title: "Detailed Statistics",
      totalSegments: "Total Segments",
      translated: "Translated",
      pending: "Pending",
      skipped: "Skipped",
      failed: "Failed",
      cacheHits: "Cache Hits",
      totalChars: "Total Characters",
      estimatedTokens: "Estimated Tokens",
      usedTokens: "Used Tokens",
      elapsedTime: "Elapsed Time",
      clearCache: "Clear Cache"
    },
    // Progress
    progress: {
      completed: "Completed",
      skipped: "Skipped",
      failed: "Failed",
      cached: "Cached",
      edited: "Edited",
      editedHint: "Click to locate edited translations"
    },
    // Footer
    footer: {
      auto: "Auto",
      batchMode: "Batch",
      batchModeOnHint: "Batch mode: translate {{count}} segments at once, faster",
      batchModeOffHint: "Single mode: translate one by one, more stable",
      glossary: "Glossary",
      glossaryEnabledHint: "Glossary enabled",
      glossaryDisabledHint: "Glossary disabled",
      translatingStatus: "Translating"
    },
    // Outline
    outline: {
      title: "Outline"
    },
    // File suffixes
    fileSuffix: {
      bilingual: "_bilingual",
      translatedOnly: "_translated"
    },
    // Default doc title
    defaultDocTitle: "Translated Document"
  },
  // ========== Error Boundary ==========
  errorBoundary: {
    title: "Something went wrong",
    windowError: "{{name}} encountered a problem",
    description: "An error occurred. Please try again or reload the page.",
    retry: "Retry",
    reload: "Reload",
    details: "Error Details"
  },
  // ========== New: Tray menu translation keys ==========
  titleBar: {
    minimize: "Minimize", maximize: "Maximize", restore: "Restore", close: "Close"
  },
  errors: {
    network: { title: "Network Error", message: "Cannot connect to translation service", s1: "Check your network connection", s2: "If using local LLM, make sure LM Studio is running", s3: "Check if firewall is blocking the connection" },
    apiKey: { title: "Invalid API Key", message: "API key is not configured or has expired", s1: "Check if the API Key is entered correctly", s2: "Confirm the API Key has not expired", s3: "Go to settings to reconfigure" },
    quota: { title: "Rate Limit Exceeded", message: "API call limit has been reached", s1: "Try again later", s2: "Switch to another translation provider", s3: "Check API account quota" },
    timeout: { title: "Request Timeout", message: "Translation service took too long to respond", s1: "Network may be slow, please retry later", s2: "If using local LLM, the model may still be loading", s3: "Try translating shorter text" },
    config: { title: "Configuration Error", message: "Translation provider is not configured correctly", s1: "Check if the API endpoint is correct", s2: "Confirm the provider is properly configured" },
    provider: { title: "Provider Unavailable", message: "Current translation provider is temporarily unavailable", s1: "Try switching to another provider", s2: "Check provider configuration" },
    ocr: { title: "OCR Failed", message: "Text recognition encountered a problem", s1: "Ensure the image is clear and contains text", s2: "Try adjusting the screenshot area", s3: "Switch to another OCR engine" },
    unknown: { title: "Operation Failed", message: "An unknown error occurred", s1: "Please try again later", s2: "If the problem persists, check settings" },
    openSettings: "Open Settings", switchProvider: "Switch Provider", retry: "Retry", checkSettings: "Check Settings",
    p: {
      localLlm: { network: "LM Studio is not running or unreachable. Please ensure LM Studio is started and a model is loaded.", config: "Please check LM Studio endpoint (default: http://localhost:1234)" },
      openai: { apiKey: "OpenAI API Key is invalid. Please check your API Key in settings.", quota: "OpenAI API quota exhausted. Please check your account balance." },
      deepl: { apiKey: "DeepL API Key is invalid. Please confirm you're using an API Key, not an account password.", quota: "DeepL free tier quota exhausted. Consider upgrading or switching providers." },
      gemini: { apiKey: "Gemini API Key is invalid. Please get a valid Key from Google AI Studio." },
      deepseek: { apiKey: "DeepSeek API Key is invalid. Please check your configuration." },
      google: { network: "Google Translate is temporarily unreachable. A network proxy may be needed." }
    }
  },
  svc: {
    noProvider: "No translation providers available",
    allFailed: "All translation providers failed",
    batchFailed: "Batch translation failed entirely",
    noUserMsg: "No user message",
    translateFailed: "Translation failed",
    providerNotFound: "Translation provider not found",
    missingConfig: "Missing configuration",
    connected: "Connected successfully",
    testFailed: "Test failed",
    connectFailed: "Connection failed",
    ocrFailed: "OCR failed",
    noTextRecognized: "(No text recognized)",
    noValidTextRecognized: "(No valid text recognized)"
  },
  docParser: {
    emptySegment: "Empty segment", tooShort: "Too short", numbersOnly: "Numbers only",
    codeBlock: "Code block", alreadyTargetLang: "Already in target language", containsKeyword: "Contains keyword",
    epubNoContainer: "Invalid EPUB: missing container.xml",
    epubNoRootfile: "Invalid EPUB: rootfile not found",
    epubNoOpf: "Invalid EPUB: OPF file not found",
    epubNoContent: "No translatable text found in EPUB",
    unsupportedFormat: "Unsupported file format",
    passwordRequired: "File requires a password",
    readFailed: "File read failed"
  },
  glossary: {
    unsupportedJson: "Unsupported JSON format",
    jsonParseFailed: "JSON parse failed",
    csvEmpty: "CSV file is empty or malformed",
    unknownFormat: "Unrecognized file format. Please use JSON, CSV, or TBX."
  },
  docParser: {
    emptySegment: "Empty segment", tooShort: "Too short", numbersOnly: "Numbers only", codeBlock: "Code block",
    alreadyTargetLang: "Already in target language", containsKeyword: "Contains keyword",
    unsupportedFormat: "Unsupported file format", unimplementedParser: "Unimplemented parser",
    passwordRequired: "File requires a password", readFailed: "File read failed",
    invalidEpubContainer: "Invalid EPUB: missing container.xml",
    invalidEpubRootfile: "Invalid EPUB: rootfile not found",
    invalidEpubOpf: "Invalid EPUB: OPF file not found",
    epubEmpty: "No translatable text found in EPUB"
  },
  tray: {
    showWindow: "Show Window",
    screenshot: "Screenshot Translate",
    glassWindow: "Glass Window",
    selectionTranslate: "Selection Translate",
    alwaysOnTop: "Always on Top",
    quit: "Quit"
  }
};

export default en;
