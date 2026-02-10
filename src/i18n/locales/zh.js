// src/i18n/locales/zh.js
// 中文语言包 - 从 i18n.js 拆分

const zh = {
  app: { name: "T-Translate", version: "版本" },
  nav: { translate: "翻译", history: "历史", favorites: "收藏", documents: "文档", settings: "设置" },
  status: { ready: "就绪", today: "今日", online: "在线", offline: "离线" },
  screenshot: { failed: "截图失败" },
  notify: { unknownError: "未知错误", networkError: "网络错误" },
  settingsNav: {
    searchPlaceholder: "搜索设置...",
    groupTranslation: "翻译", groupSystem: "系统",
    providers: "翻译源", translation: "翻译设置", selection: "划词翻译", glassWindow: "悬浮翻译", document: "文档翻译",
    ocr: "OCR 识别", tts: "朗读设置", interface: "界面外观", connection: "LM Studio", privacy: "隐私模式", about: "关于",
    export: "导出", import: "导入", reset: "重置",
    noMatch: "未找到匹配的设置",
    unsavedChanges: "有未保存的更改", saving: "保存中...", saveChanges: "保存更改"
  },
  providerSettings: {
    title: "翻译源设置", description: "配置翻译服务，支持本地模型和在线 API",
    priorityHint: "按优先级顺序尝试翻译，第一个成功的将被使用。拖动卡片调整顺序。",
    configDetails: "配置详情", testConnection: "测试连接",
    testing: "测试中...", connected: "已连接", connectionFailed: "连接失败", notTested: "未测试",
    noConfig: "此翻译源无需额外配置，开箱即用",
    saved: "翻译源设置已保存", saveFailed: "保存失败",
    enabledSection: "已启用", disabledSection: "未启用",
    noEnabled: "尚未启用任何翻译源", enable: "启用", getApiKey: "获取 API Key",
    typeLabels: { llm: "AI 大模型", api: "专业 API", traditional: "传统翻译" },
    names: {
      'local-llm': 'LM Studio (本地)',
      'openai': 'OpenAI',
      'deepl': 'DeepL',
      'gemini': 'Google Gemini',
      'deepseek': 'DeepSeek',
      'google-translate': 'Google 翻译'
    },
    descriptions: {
      'local-llm': '使用本地大模型翻译，隐私安全、免费',
      'openai': '使用 GPT 模型翻译，质量高、速度快',
      'deepl': '专业翻译 API，翻译质量极高',
      'gemini': 'Google AI 大模型，免费额度，翻译质量高',
      'deepseek': '国产 AI 大模型，价格实惠，中文翻译质量好',
      'google-translate': '免费使用，支持语言多，速度快'
    }
  },
  translationSettings: {
    title: "翻译设置", description: "配置翻译行为和输出方式",
    autoTranslate: "自动翻译", autoTranslateHint: "输入停止后自动开始翻译",
    autoDelay: "自动翻译延迟", autoDelayHint: "停止输入后等待多久开始翻译",
    streamOutput: "流式输出（打字机效果）", streamOutputHint: "开启后翻译结果将逐字显示",
    cache: "翻译缓存", cacheHint: "缓存已翻译的内容，相同文本再次翻译时直接返回结果",
    clearCache: "清除缓存", clearCacheConfirm: "确定要清除翻译缓存吗？", cacheCleared: "缓存已清除"
  },
  documentSettings: {
    title: "文档翻译设置", description: "配置文档翻译的分段策略、过滤规则和显示样式",
    segmentSettings: "分段设置", maxCharsPerSegment: "单段最大字符数", segmentHint: "过长的段落会按此限制自动分割",
    batchTranslation: "批量翻译", batchMaxTokens: "每批最大 Tokens", batchMaxSegments: "每批最大段落数",
    batchHint: "合并短段落可减少 API 调用次数",
    smartFilter: "智能过滤", skipShort: "跳过过短段落", minLength: "最小字符数",
    skipNumbers: "跳过纯数字段落（如页码）", skipCode: "保留代码块不翻译", skipTargetLang: "跳过已是目标语言的段落",
    displayStyle: "默认显示样式",
    styleBelow: "上下对照 - 译文显示在原文下方", styleSideBySide: "左右对照 - 原文和译文并排显示",
    styleSourceOnly: "仅原文 - 隐藏译文", styleTranslatedOnly: "仅译文 - 隐藏原文",
    supportedFormats: "支持的文件格式", formatHint: "支持加密 PDF · 自动识别章节大纲 · 翻译记忆复用"
  },
  shortcuts: {
    title: "快捷键",
    translate: "执行翻译", swapLanguages: "切换语言", clear: "清空内容", paste: "粘贴文本", copy: "复制结果",
    screenshot: "截图翻译", toggleWindow: "显示/隐藏窗口", glassWindow: "悬浮翻译", selectionTranslate: "划词翻译开关",
    hint: "点击快捷键可进行修改，按 Esc 取消。带 🌐 标记的为全局快捷键",
    pressKey: "按下快捷键...", resetDefault: "重置为默认",
    updated: "快捷键已更新: {{label}} → {{shortcut}}", updateFailed: "快捷键更新失败: {{error}}", reset: "快捷键已重置为默认值"
  },
  toolbar: { glass: "悬浮翻译", screenshot: "截图翻译", selection: "划词翻译", selectionOn: "划词已开启", selectionOff: "划词已关闭", privacy: "隐私模式", theme: "主题" },
  templates: { natural: "自然", naturalDesc: "日常/口语", precise: "精确", preciseDesc: "技术/学术", formal: "正式", formalDesc: "商务/官方" },
  translation: {
    sourceLang: "源语言", targetLang: "目标语言", auto: "自动检测",
    inputPlaceholder: "输入要翻译的文本...", outputPlaceholder: "翻译结果将显示在这里",
    translate: "翻译", translating: "翻译中...", copy: "复制", copied: "已复制", clear: "清空",
    swap: "交换语言", speak: "朗读", stop: "停止", favorite: "收藏", favorited: "已收藏", characters: "字符",
    source: "原文", target: "译文", recognizing: "识别中...",
    screenshot: "截图识别", importImage: "导入图片", paste: "粘贴",
    speakSource: "朗读原文", speakTarget: "朗读译文", stopSpeak: "停止朗读",
    ocrProcessing: "正在识别图片中的文字...", dropFile: "释放文件以导入...",
    noTextToSpeak: "没有可朗读的文本", speakFailed: "朗读失败",
    ocrRecognizing: "正在识别文字...", ocrSuccess: "识别成功 ({{engine}})", ocrFailed: "未能识别到文字",
    enterText: "请输入要翻译的内容", notConnected: "LM Studio 未连接，请检查连接或使用离线模式",
    translateFirst: "请先进行翻译", selectStyle: "请选择一个参考风格",
    styleRewriteComplete: "风格改写完成", styleRewriteFailed: "风格改写失败",
    savedToStyle: "已收藏到风格库", saved: "已收藏",
    imageOcrRecognizing: "正在识别图片文字...", imageOcrSuccess: "文字识别成功",
    fileImportSuccess: "文件导入成功", unsupportedFileType: "不支持的文件类型",
    recognizingClipboard: "发现剪贴板图片，正在识别...",
    autoReplaced: "已自动替换: {{info}}", copiedForManualReplace: "已复制 \"{{text}}\"，请在译文中手动替换",
    termSet: "已设置术语"
  },
  languages: { auto: "自动检测", zh: "中文", "zh-TW": "繁体中文", en: "English", ja: "日本語", ko: "한국어", fr: "Français", de: "Deutsch", es: "Español", ru: "Русский", pt: "Português", it: "Italiano" },
  history: { 
    title: "翻译历史", search: "搜索历史...", empty: "暂无历史记录", clearAll: "清空", clearConfirm: "确定要清空所有历史记录吗？", 
    delete: "删除", restore: "恢复编辑", today: "今天", yesterday: "昨天", thisWeek: "本周", thisMonth: "本月", earlier: "更早",
    view: { card: "卡片", table: "表格" },
    filter: { all: "全部时间", today: "今天", week: "本周", month: "本月" },
    group: { date: "按日期", language: "按语言" },
    select: "选择", export: "导出", import: "导入",
    deleteSelected: "删除 ({{count}})",
    deleteSelectedConfirm: "确定删除选中的 {{count}} 条记录？",
    deletedCount: "已删除 {{count}} 条",
    clearAllConfirm: "确定清空所有 {{count}} 条记录？",
    searchResult: "搜索 \"{{keyword}}\" 找到 {{count}} 条结果",
    searchHint: "（↑↓ 导航，Enter 复制）",
    loadMore: "加载更多 ({{count}} 条)",
    showing: "显示 {{current}} / {{total}} 条",
    selectedHint: "已选 {{count}} 条 | 空格选择，Esc 退出",
    copySource: "复制原文", copyTarget: "复制译文", favorite: "收藏", unfavorite: "取消收藏",
    copied: "已复制译文", restored: "已恢复到编辑区", favorited: "已收藏", unfavorited: "已取消收藏",
    exportSuccess: "导出成功", exportFailed: "导出失败", cleared: "已清空",
    secureMode: { title: "无痕模式已启用", desc: "当前模式下不会保存任何翻译历史记录。如需保存历史，请切换到标准模式。" },
    stats: { 
      title: "统计", total: "总记录", today: "今日翻译", thisWeek: "本周", 
      totalChars: "总字符", avgLength: "平均长度", streak: "连续天数", languagePairs: "常用语言对" 
    },
    table: { time: "时间", language: "语言", source: "原文", target: "译文", actions: "操作" },
    card: { clickHint: "点击切换原文/译文，双击查看详情", source: "原文", target: "译文" }
  },
  favorites: { 
    title: "收藏夹", search: "搜索收藏...", empty: "暂无收藏", noMatch: "没有找到匹配的收藏", 
    emptyHint: "在翻译结果中点击星标可添加收藏",
    clearAll: "清空全部", delete: "删除", tags: "标签", addTag: "添加标签", noTags: "无标签",
    newFolder: "新建文件夹", folderName: "文件夹名称", create: "创建",
    allFavorites: "全部收藏", uncategorized: "未分类",
    folders: { work: "工作", study: "学习", life: "生活", glossary: "术语库", styleLibrary: "风格库" },
    importTerms: "导入术语", exportTerms: "导出术语",
    terms: "条术语", items: "条收藏", note: "备注", actions: "操作",
    addNote: "添加备注...", save: "保存", cancel: "取消", edit: "编辑", copy: "复制",
    movedToStyle: "已移动到风格库", movedFromStyle: "已移出风格库", deleted: "已删除", copied: "已复制译文",
    deleteConfirm: "确定要删除这条收藏吗？", termUpdated: "术语已更新",
    aiTagSuccess: "AI 标签生成成功", aiTagFailed: "AI 标签生成失败",
    aiGenerateTags: "AI 智能生成标签", aiGenerate: "AI 生成", generating: "生成中...",
    markAsStyle: "标记为风格参考", willMoveToStyle: "将移动到风格库", normalFavorite: "普通收藏",
    moveTo: "移动到", moveToFolder: "移动到文件夹", copyTarget: "复制译文", editTagsNotes: "编辑标签和笔记",
    glossaryEmpty: "术语库为空", folderDeleted: "文件夹已删除", folderCreated: "文件夹已创建",
    deleteFolderConfirm: "删除文件夹后，其中的收藏将移至\"未分类\"",
    moved: "已移动", noValidTerms: "未找到有效术语",
    exportedTerms: "已导出 {{count}} 条术语 ({{format}})",
    importedTerms: "已导入 {{count}} 条术语", importSkipped: "（跳过 {{skipped}} 条重复）",
    importFailed: "导入失败",
    tagsLabel: "标签（逗号分隔）", tagsPlaceholder: "正式, 学术, 重要...",
    noteLabel: "笔记", notePlaceholder: "添加笔记..."
  },
  connectionSettings: {
    title: "LM Studio 连接设置", endpoint: "API 端点", timeout: "超时时间 (ms)",
    testing: "测试中...", testConnection: "测试连接", availableModels: "可用模型",
    connectionSuccess: "连接成功！检测到 {{count}} 个模型", connectionFailed: "连接失败", connectionError: "连接错误"
  },
  documents: { title: "文档翻译", upload: "上传文档", dragDrop: "拖拽文件到这里，或点击上传", supported: "支持 PDF、DOCX、EPUB、TXT 格式", translating: "翻译中...", download: "下载译文", preview: "预览" },
  privacy: {
    modeDescription: "选择适合您需求的工作模式，不同模式下可用功能不同",
    currentMode: "当前模式",
    featuresTitle: "当前模式功能说明",
    switchedTo: "已切换到 {{mode}}",
    clearHistoryConfirm: "确定要清除所有翻译历史吗？",
    historyCleared: "历史记录已清除",
    clearAllConfirm: "确定要清除所有本地数据吗？这将重置所有设置。",
    features: { history: "历史记录", cache: "翻译缓存", onlineApi: "在线翻译API", analytics: "使用统计" },
    save: "保存", noSave: "不保存", allow: "允许", deny: "禁止", collect: "收集", noCollect: "不收集",
    offlineWarning: "离线模式下仅可使用本地 LLM 翻译，在线翻译源（OpenAI、DeepL等）将被禁用",
    incognitoWarning: "无痕模式已开启：翻译记录暂停保存，退出后恢复之前的历史",
    dataManagement: "数据管理",
    autoDeleteHistory: "自动删除历史记录",
    daysLater: "天后",
    zeroMeansNever: "设为 0 表示永不自动删除",
    incognitoDisabled: "（无痕模式下此选项无效）"
  },
  glass: { 
    title: "悬浮翻译", pin: "置顶", unpin: "取消置顶", opacity: "透明度", close: "关闭", addPanel: "添加子面板", removePanel: "移除子面板", clearAll: "清空全部",
    description: "配置悬浮翻译窗口的行为和外观",
    lockTargetLang: "锁定目标语言", lockTargetLangOnDesc: "始终翻译成目标语言", lockTargetLangOffDesc: "根据原文自动切换（可能导致回译）", lockTargetLangHint: "建议开启，避免中英文来回切换",
    smartDetect: "智能检测", smartDetectOnDesc: "自动跳过未变化的内容", smartDetectOffDesc: "每次都重新识别翻译",
    ocrEngine: "OCR 引擎", useGlobalOcr: "使用全局 OCR 设置（当前：{{engine}}）", goToSettings: "前往设置",
    defaultOpacity: "默认透明度", opacityHint: "在玻璃窗中点击小横条可实时调节",
    windowOptions: "窗口选项", rememberPosition: "记住窗口位置", autoPin: "默认置顶显示",
    shortcut: { toggle: "打开/关闭悬浮翻译", capture: "手动截图识别", exit: "关闭窗口" },
    instructions: "使用说明",
    normalMode: "普通模式", normalModeDesc: "点击 📷 截图识别当前区域",
  },
  selection: { 
    freeze: "冻结", unfreeze: "解冻", close: "关闭", copy: "复制", more: "更多",
    description: "选中文字后显示翻译按钮，点击即可翻译",
    enableSelection: "启用划词翻译", enabled: "划词翻译已开启", disabled: "划词翻译已关闭",
    enabledDesc: "选中文字后显示翻译按钮", disabledDesc: "已禁用划词翻译", toggleFailed: "切换划词翻译失败",
    shortcutHint: "也可以使用快捷键 {{shortcut}} 快速切换",
    triggerTimeout: "按钮自动消失时间", seconds: "秒", triggerTimeoutHint: "划词后翻译按钮自动消失的时间",
    showSourceByDefault: "默认显示原文", showSourceOnDesc: "翻译结果默认显示原文对照", showSourceOffDesc: "只显示翻译结果",
    autoCloseOnCopy: "复制后自动关闭", autoCloseOnDesc: "点击复制后自动关闭翻译窗口", autoCloseOffDesc: "复制后保持窗口打开",
    windowOpacity: "窗口透明度", opacityHint: "调整划词翻译窗口的透明度",
    screenshotOutput: "截图翻译输出", bubble: "气泡窗口", mainWindow: "主窗口",
    bubbleDesc: "截图翻译结果显示在悬浮气泡中", mainWindowDesc: "截图翻译结果显示在主窗口中", outputHint: "气泡模式下，截图后后台处理，完成后弹出结果",
    charLimit: "字符数限制", minChars: "最小", maxChars: "最大", charLimitHint: "少于最小或超过最大字符数的选中内容不会触发翻译",
    instructions: "使用说明", workflow: "划词翻译流程",
    step1: "用鼠标选中需要翻译的文字", step2: "松开鼠标后，旁边出现翻译按钮", step3: "点击按钮开始翻译", step4: "翻译完成后显示结果卡片",
    quickActions: "快捷操作", action1: "拖动标题栏移动窗口", action2: "右下角调整大小", action3: "点击「原文」显示原文对照", action4: "点击「复制」或直接选中文字复制", action5: "按 ESC 或右键关闭"
  },
  settings: {
    title: "设置",
    saved: "设置已保存", saveFailed: "保存设置失败",
    exported: "设置已导出", invalidFormat: "设置文件格式不正确", importedPleasesSave: "设置已导入，请保存以生效", invalidFile: "无效的设置文件",
    resetSectionConfirm: "重置 \"{{section}}\" 的设置？", resetAllConfirm: "重置所有设置？这将清除所有自定义配置。",
    sectionReset: "{{section}} 设置已重置", sectionNotFound: "未找到 {{section}} 的默认设置", allReset: "所有设置已重置",
    tabs: { general: "通用", providers: "翻译源", ocr: "OCR", shortcuts: "快捷键", privacy: "隐私", tts: "语音", glossary: "术语表", about: "关于" },
    general: {
      title: "通用设置", language: "界面语言", languageDesc: "选择应用界面显示语言",
      theme: "主题", themeDesc: "选择应用外观主题",
      themes: { default: "默认", fresh: "清新", dark: "暗色" },
      startup: "开机启动", startupDesc: "系统启动时自动运行", minimize: "最小化到托盘", minimizeDesc: "关闭窗口时最小化到系统托盘",
      defaultSource: "默认源语言", defaultTarget: "默认目标语言"
    },
    providers: {
      title: "翻译源设置", enable: "启用", disable: "禁用", test: "测试连接", testing: "测试中...", testSuccess: "连接成功", testFailed: "连接失败",
      priority: "优先级", priorityDesc: "拖拽调整翻译源优先级", apiKey: "API Key", apiKeyPlaceholder: "请输入 API Key", baseUrl: "API 地址", model: "模型", getKey: "获取 Key",
      localLlm: { name: "本地 LLM", desc: "使用本地大模型翻译，完全离线", endpoint: "API 端点", endpointPlaceholder: "http://localhost:1234/v1" },
      openai: { name: "OpenAI", desc: "使用 GPT 模型翻译" }, deepl: { name: "DeepL", desc: "高质量翻译服务" },
      gemini: { name: "Gemini", desc: "Google AI 翻译" }, deepseek: { name: "DeepSeek", desc: "国产大模型翻译" }, google: { name: "Google 翻译", desc: "Google 免费翻译服务" }
    },
    ocr: { title: "OCR 设置", engine: "OCR 引擎", engineDesc: "选择文字识别引擎", engines: { rapid: "RapidOCR（本地）", windows: "Windows OCR", llmVision: "LLM Vision" }, language: "识别语言", languageDesc: "选择要识别的语言" },
    shortcuts: { title: "快捷键设置", desc: "自定义全局快捷键", showWindow: "显示/隐藏主窗口", screenshot: "截图翻译", glassWindow: "悬浮翻译", selectionToggle: "开启/关闭划词翻译", recording: "按下快捷键...", conflict: "快捷键冲突", reset: "重置默认" },
    privacy: {
      title: "隐私设置", mode: "隐私模式", modeDesc: "控制数据存储和网络请求",
      modes: { standard: "标准模式", standardDesc: "正常功能，记录历史", offline: "离线模式", offlineDesc: "仅使用本地翻译源", incognito: "无痕模式", incognitoDesc: "不记录历史和缓存", strict: "严格模式", strictDesc: "离线 + 无痕" },
      clearHistory: "清除历史记录", clearCache: "清除缓存", clearAll: "清除所有数据"
    },
    tts: { title: "语音设置", enable: "启用 TTS", enableDesc: "开启翻译结果语音朗读", voice: "语音", voiceDesc: "选择朗读语音", rate: "语速", rateDesc: "调整朗读速度", pitch: "音调", pitchDesc: "调整语音音调", volume: "音量", volumeDesc: "调整朗读音量", test: "测试", testText: "这是一段测试文本" },
    glossary: { title: "术语表", desc: "自定义翻译术语，确保专业词汇翻译一致", add: "添加术语", source: "原文", target: "译文", empty: "暂无术语", import: "导入", export: "导出", delete: "删除", save: "保存" },
    about: { title: "关于", version: "版本", checkUpdate: "检查更新", checking: "检查中...", upToDate: "已是最新版本", newVersion: "发现新版本", download: "前往下载", later: "稍后再说", releaseNotes: "更新内容", publishedAt: "发布时间", github: "GitHub", feedback: "反馈问题", license: "开源协议", copyright: "© 2026 T-Translate" },
    selection: { title: "划词翻译" },
    glass: { title: "悬浮翻译" }
  },
  about: {
    desc: "智能离线翻译工具",
    features: "核心特性",
    feature1: "本地 LLM 翻译，数据不出设备",
    feature2: "多引擎 OCR 文字识别",
    feature3: "PDF/DOCX/EPUB 文档翻译",
    feature4: "划词翻译 + 悬浮翻译",
    techStack: "技术栈",
    openLogs: "打开日志目录",
    logDirOpened: "已打开日志目录",
    logDirFailed: "无法打开日志目录",
    updateUnavailable: "检查更新功能不可用",
    updateFailed: "检查更新失败",
    noReleases: "暂无发布版本，已是最新",
    currentVersion: "当前版本",
    latestVersion: "最新版本"
  },
  notify: { 
    success: "成功", error: "错误", warning: "警告", info: "提示", 
    copySuccess: "已复制到剪贴板", copyFailed: "复制失败", 
    saveSuccess: "保存成功", saveFailed: "保存失败",
    networkError: "网络错误", translateError: "翻译失败", ocrError: "识别失败", 
    shortcutRegistered: "快捷键已注册", shortcutConflict: "快捷键冲突"
  },
  common: { confirm: "确定", cancel: "取消", save: "保存", delete: "删除", edit: "编辑", close: "关闭", open: "打开", enable: "启用", disable: "禁用", loading: "加载中...", noData: "暂无数据", retry: "重试", reset: "重置", search: "搜索", filter: "筛选", all: "全部", none: "无", yes: "是", no: "否", show: "显示", hide: "隐藏", on: "开启", off: "关闭" },
  ocr: {
    description: "配置文字识别引擎和语言",
    recognitionLanguage: "识别语言",
    lang: { auto: "自动检测", zhHans: "简体中文", zhHant: "繁体中文", en: "英文", ja: "日文", ko: "韩文", fr: "法文", de: "德文", es: "西班牙文", ru: "俄文" },
    autoLangHint: "选择「自动检测」时，将根据翻译设置自动选择",
    showConfirmButtons: "显示截图确认按钮", confirmButtonsHint: "启用后，选择区域后需点击确认或按 Enter 键",
    autoEnlarge: "自动放大小图片", enlargeHint: "小字体（<15px）识别率低，自动放大可提升准确率",
    scaleFactor: "放大倍数", recommended: "（推荐）",
    localEngines: "本地 OCR 引擎", localHint: "毫秒级响应，推荐优先使用",
    visionModels: "视觉大模型", visionHint: "深度识别，处理复杂场景",
    onlineServices: "在线 OCR 服务", onlineHint: "精准模式，需联网",
    onlineNote: "商业 API 训练数据最多，识别精度最高。隐私模式下自动禁用。",
    installed: "已安装", needDownload: "需下载 ~60MB", builtin: "内置",
    rapidDesc: "基于 PP-OCRv4，标准文字识别率 98%+，速度最快",
    llmVisionDesc: "处理艺术字、手写体、模糊文字、漫画气泡等复杂场景",
    llmVisionMeta: "需要 LM Studio + 视觉模型（如 Qwen-VL）",
    free25k: "免费 25000次/月", free5k: "免费 5000次/月", free1k: "免费 1000次/月",
    ocrspaceDesc: "免费额度最高，支持 25+ 语言",
    googleVisionDesc: "识别效果最好，支持 200+ 语言",
    azureDesc: "微软认知服务，手写识别强",
    azureEndpoint: "Endpoint (如 https://xxx.cognitiveservices.azure.com)",
    baiduOcr: "百度 OCR", baiduDesc: "中文识别强，支持身份证、银行卡等",
    use: "使用", inUse: "✓ 使用中", download: "下载", uninstall: "卸载",
    downloading: "开始下载 RapidOCR...", downloadComplete: "下载完成！建议重启应用", downloadFailed: "下载失败",
    uninstallConfirm: "确定要卸载 RapidOCR 吗？", uninstalling: "正在卸载...", uninstalled: "已卸载", uninstallFailed: "卸载失败",
    configKeyFirst: "请先配置 API Key", configKeyEndpoint: "请先配置 API Key 和 Endpoint", configKeySecret: "请先配置 API Key 和 Secret Key",
    // 健康检查与修复
    engineBroken: "异常", checking: "检查中", healthUnknownError: "未知错误",
    engineErrorTitle: "OCR 引擎异常", 
    repair: "修复", repairing: "修复中...", repairStarting: "正在准备修复...",
    repairSuccess: "RapidOCR 修复成功，建议重启应用", repairFailed: "修复失败", repairRestartHint: "请重启应用以确保修复生效",
    recheckHealth: "重新检查引擎状态"
  },
  tts: {
    description: "配置文本朗读功能和语音参数",
    enableTTS: "启用文本朗读", enableHint: "在翻译面板显示朗读按钮",
    defaultVoice: "默认语音", autoSelect: "自动选择", refreshVoices: "刷新语音列表",
    voicesLoaded: "已加载 {{count}} 个可用语音", autoSelectHint: "自动根据文本语言选择合适的语音",
    rate: "语速", rateHint: "调整朗读速度，1.0 为正常语速",
    pitch: "音调", pitchHint: "调整声音音调，1.0 为正常音调",
    volume: "音量", volumeHint: "调整朗读音量大小",
    preview: "试听效果", previewHint: "使用当前设置播放测试语音",
    play: "播放试听", stop: "停止播放",
    testTextMixed: "这是语音朗读测试。This is a TTS test.",
    testTextChinese: "你好，这是语音朗读功能测试。",
    testFailed: "试听失败", loadVoicesFailed: "加载语音列表失败",
    noVoicesInstalled: "系统未安装任何语音包，请在系统设置中安装语音",
    noVoiceForLang: "系统未安装{{lang}}语音包，无法朗读此语言",
    installVoiceHint: "Windows: 设置 → 时间和语言 → 语音；macOS: 系统设置 → 辅助功能 → 语音内容",
    langNames: { zh: "中文", en: "英语", ja: "日语", ko: "韩语", fr: "法语", de: "德语", es: "西班牙语", ru: "俄语", pt: "葡萄牙语", it: "意大利语" }
  },
  // ========== 新增：文档翻译组件翻译键 ==========
  documentTranslator: {
    title: "文档翻译",
    // 显示样式
    displayStyles: {
      below: "上下对照",
      sideBySide: "左右对照",
      sourceOnly: "仅原文",
      translatedOnly: "仅译文"
    },
    // 段落状态
    status: {
      translating: "翻译中...",
      pending: "等待翻译",
      failed: "翻译失败"
    },
    // 按钮和操作
    actions: {
      retry: "重试",
      export: "导出",
      startTranslation: "开始翻译",
      pause: "暂停",
      resume: "继续",
      stop: "停止",
      retryFailed: "重试失败 ({{count}})"
    },
    // 上传区域
    upload: {
      dropHere: "拖放文件到这里",
      orClick: "或点击选择文件",
      supported: "支持：{{formats}}",
      parsing: "正在解析文件..."
    },
    // 密码弹窗
    password: {
      title: "文件已加密",
      desc: "文件 <strong>{{filename}}</strong> 需要密码才能打开",
      placeholder: "请输入密码",
      cancel: "取消",
      confirm: "确定",
      wrongPassword: "密码错误，请重试"
    },
    // 通知消息
    notify: {
      fileLoaded: "文件加载成功：{{count}} 个段落",
      fileLoadedWithPages: "文件加载成功：{{count}} 个段落 ({{pages}} 页)",
      parseFailed: "文件解析失败",
      translationComplete: "翻译完成",
      translationCompleteFromCache: "翻译完成（全部来自缓存）",
      retrySuccess: "重试成功",
      retryFailed: "重试失败: {{error}}",
      exportSuccess: "导出成功",
      exportFailed: "导出失败: {{error}}",
      printToPdf: "请在打印对话框中选择\"保存为 PDF\"",
      cacheCleared: "翻译记忆缓存已清除"
    },
    // 导出菜单
    export: {
      textFormat: "文本格式",
      bilingualTxt: "双语 TXT",
      bilingualMd: "双语 Markdown",
      translatedOnlyTxt: "仅译文 TXT",
      docFormat: "文档格式",
      bilingualWord: "双语 Word (.doc)",
      translatedOnlyWord: "仅译文 Word (.doc)",
      exportPdf: "导出 PDF (打印)",
      subtitleFormat: "字幕格式",
      srtSubtitle: "SRT 字幕",
      vttSubtitle: "VTT 字幕"
    },
    // 统计信息
    stats: {
      title: "详细统计",
      totalSegments: "总段落",
      translated: "已翻译",
      pending: "待翻译",
      skipped: "已跳过",
      failed: "失败",
      cacheHits: "缓存命中",
      totalChars: "总字符",
      estimatedTokens: "预估 Tokens",
      usedTokens: "已用 Tokens",
      elapsedTime: "翻译用时",
      clearCache: "清除缓存"
    },
    // 进度信息
    progress: {
      completed: "已完成",
      skipped: "跳过",
      failed: "失败",
      cached: "缓存"
    },
    // 底部控制栏
    footer: {
      auto: "自动",
      batchMode: "批量",
      batchModeOnHint: "批量模式：每次翻译 {{count}} 段，速度更快",
      batchModeOffHint: "逐条模式：一段一段翻译，更稳定",
      glossary: "术语",
      glossaryEnabledHint: "术语表已启用",
      glossaryDisabledHint: "术语表已禁用",
      translatingStatus: "翻译中"
    },
    // 大纲
    outline: {
      title: "大纲"
    },
    // 文件名后缀
    fileSuffix: {
      bilingual: "_双语",
      translatedOnly: "_译文"
    },
    // 默认文档标题
    defaultDocTitle: "翻译文档"
  },
  // ========== 新增：托盘菜单翻译键 ==========
  tray: {
    showWindow: "显示窗口",
    screenshot: "截图翻译",
    glassWindow: "悬浮翻译",
    selectionTranslate: "划词翻译",
    alwaysOnTop: "置顶",
    quit: "退出"
  }
};

export default zh;
