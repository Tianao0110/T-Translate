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
    providers: "翻译源", translation: "翻译设置", selection: "划词翻译", glassWindow: "玻璃窗口", document: "文档翻译",
    ocr: "OCR 识别", tts: "朗读设置", interface: "界面外观", connection: "LM Studio", privacy: "隐私模式", about: "关于",
    export: "导出", import: "导入", reset: "重置",
    simpleMode: "简洁", fullMode: "完整", switchToFull: "完整", switchToSimple: "简洁",
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
    noEnabled: "尚未启用任何翻译源",
    enable: "启用",
    getApiKey: "获取 API Key",
    typeLabels: { llm: "AI 大模型", api: "专业 API", traditional: "传统翻译" },
    names: {
      'local-llm': 'LM Studio (本地)',
      'openai': 'OpenAI',
      'deepl': 'DeepL',
      'gemini': 'Google Gemini',
      'deepseek': 'DeepSeek',
      'google-translate': 'Google 翻译',
      'ollama': 'Ollama (本地)',
      'anthropic': 'Anthropic Claude',
      'microsoft-translator': 'Microsoft 翻译',
      'baidu-translate': '百度翻译'
    },
    descriptions: {
      'local-llm': '使用本地大模型翻译，隐私安全、免费',
      'openai': '使用 GPT 模型翻译，质量高、速度快',
      'deepl': '专业翻译 API，翻译质量极高',
      'gemini': 'Google AI 大模型，免费额度，翻译质量高',
      'deepseek': '国产 AI 大模型，价格实惠，中文翻译质量好',
      'google-translate': '免费使用，支持语言多，速度快',
      'ollama': '使用 Ollama 本地大模型翻译，隐私安全、免费',
      'anthropic': 'Claude AI 大模型，翻译质量极高',
      'microsoft-translator': '微软翻译 API，免费 200 万字/月',
      'baidu-translate': '百度翻译 API，国内直连、免费额度'
    }
  },
  providerConfig: {
    'local-llm': { endpoint: 'API 地址', model: '模型名称', timeout: '超时时间 (ms)', model_placeholder: '留空自动检测' },
    'openai': { apiKey: 'API Key', endpoint: 'API 地址', model: '模型名称' },
    'deepl': { apiKey: 'API Key', freeApi: '使用免费 API（Key 以 :fx 结尾）' },
    'gemini': { apiKey: 'API Key', model: '模型' },
    'deepseek': { apiKey: 'API Key', model: '模型', endpoint: 'API 地址' },
    'google-translate': { domain: '服务器', domain_com: 'google.com (国际)', domain_cn: 'google.cn (中国)', 'domain_com.hk': 'google.com.hk (香港)' },
    'ollama': { endpoint: 'API 地址', model: '模型名称', timeout: '超时时间 (ms)', model_placeholder: '留空自动检测（如 llama3, qwen2 等）' },
    'anthropic': { apiKey: 'API Key', model: '模型', baseUrl: 'API 地址' },
    'microsoft-translator': { apiKey: 'API Key', region: '区域' },
    'baidu-translate': { appId: 'APP ID', secretKey: '密钥' },
    ocr: { language: '识别语言', language_chs: '简体中文', language_cht: '繁体中文', language_eng: 'English', language_jpn: '日本語', language_kor: '한국어' }
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
    screenshot: "截图翻译", toggleWindow: "显示/隐藏窗口", glassWindow: "玻璃窗口", selectionTranslate: "划词翻译开关",
    hint: "点击快捷键可进行修改，按 Esc 取消。带 🌐 标记的为全局快捷键",
    pressKey: "按下快捷键...", resetDefault: "重置为默认",
    updated: "快捷键已更新: {{label}} → {{shortcut}}", updateFailed: "快捷键更新失败: {{error}}", reset: "快捷键已重置为默认值",
    conflictNotice: "快捷键被其他程序占用: {{shortcuts}}，可在设置中修改"
  },
  toolbar: { glass: "玻璃窗口", screenshot: "截图翻译", selection: "划词翻译", selectionOn: "划词已开启", selectionOff: "划词已关闭", privacy: "隐私模式", theme: "主题" },
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
    termSet: "已设置术语",
    glossaryApplied: "术语库已自动替换",
    glossaryItems: "项",
    glossaryUndone: "已撤销术语替换",
    undo: "撤销",
    styleRewrite: "风格改写",
    termFound: "发现可替换术语",
    applyTerm: "应用此翻译", apply: "应用",
    ignoreTerm: "忽略此次",
    neverRemind: "不再提示",
    alwaysUseTerm: "始终使用此术语", always: "始终",
    selectStyle: "选择参考风格", fromStyleLib: "从风格库中选择",
    styleLibEmpty: "风格库为空", styleLibHint: "收藏时勾选\"标记为风格参考\"添加到风格库",
    styleStrength: "风格强度", strengthLight: "轻微", strengthFull: "完全模仿",
    strengthDescLight: "轻微调整，基本保持原译文风格",
    strengthDescMedium: "中等程度模仿参考风格",
    strengthDescHigh: "高度模仿，尽量贴近参考风格的语气和表达",
    startRewrite: "开始改写",
    addToFavorites: "添加到收藏", aiSuggestions: "AI 建议", reanalyze: "重新分析",
    aiAnalyzing: "AI 正在分析内容...", summaryNote: "摘要/笔记", shortDesc: "简短描述...",
    aiRecommended: "AI 推荐",
    saveToStyleLib: "将保存到\"风格库\"，可用于风格改写", saveAsNormal: "保存为普通收藏",
    saveToStyleLibBtn: "保存到风格库", saveFavorite: "保存收藏",
    analysisFailed: "分析失败",
    rewriteFailed: "改写失败",
    versionOriginal: "原始", versionOriginalFull: "原始翻译",
    versionStyleRewrite: "风格改写", versionUserEdit: "用户编辑", versionUnknown: "未知"
  },
  languages: { auto: "自动检测", zh: "中文", "zh-TW": "繁体中文", en: "English", ja: "日本語", ko: "한국어", fr: "Français", de: "Deutsch", es: "Español", ru: "Русский", pt: "Português", it: "Italiano", ar: "العربية", th: "ไทย", vi: "Tiếng Việt", pa: "ਪੰਜਾਬੀ" },
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
    importedCount: "导入 {{count}} 条", importFailed: "导入失败", noMatch: "没有找到匹配的记录",
    emptyHint: "翻译内容会自动保存在这里",
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
    modes: {
      standard: "标准模式", standardDesc: "功能全开，自动保存历史记录",
      incognito: "无痕模式", incognitoDesc: "不保存任何记录，关闭窗口即清除",
      offline: "离线模式", offlineDesc: "完全离线，不发送任何网络请求",
      strict: "严格模式", strictDesc: "最高隐私保护，仅本地处理"
    },
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
    title: "玻璃窗口", pin: "置顶", unpin: "取消置顶", opacity: "透明度", close: "关闭", addPanel: "添加子面板", removePanel: "移除子面板", clearAll: "清空全部",
    description: "配置悬浮翻译窗口的行为和外观",
    lockTargetLang: "锁定目标语言", lockTargetLangOnDesc: "始终翻译成目标语言", lockTargetLangOffDesc: "根据原文自动切换（可能导致回译）", lockTargetLangHint: "建议开启，避免中英文来回切换",
    smartDetect: "智能检测", smartDetectOnDesc: "自动跳过未变化的内容", smartDetectOffDesc: "每次都重新识别翻译",
    ocrEngine: "OCR 引擎", useGlobalOcr: "使用全局 OCR 设置（当前：{{engine}}）", goToSettings: "前往设置",
    defaultOpacity: "默认透明度", opacityHint: "在玻璃窗中点击小横条可实时调节",
    windowOptions: "窗口选项", rememberPosition: "记住窗口位置", autoPin: "默认置顶显示",
    shortcut: { toggle: "打开/关闭玻璃窗口", capture: "手动截图识别", exit: "退出字幕模式/关闭窗口" },
    instructions: "使用说明",
    normalMode: "普通模式", normalModeDesc: "点击 📷 截图识别当前区域",
    subtitleMode: "字幕模式", subtitleModeDesc: "点击 🎬 开启实时字幕翻译",
    firstUse: "首次使用字幕模式", firstUseDesc: "需要先框选视频原字幕区域",
    // 玻璃窗口组件内文案
    captureSpace: "截图识别 (Space)", historyCtrlH: "历史记录 (Ctrl+H)",
    adjustOpacity: "点击调节透明度", closeEsc: "关闭 (Esc)",
    capturing: "截图中...", recognizing: "识别中...", translating: "翻译中...",
    captureHint: "点击 📷 或按 Space 截图识别",
    doubleClickFreeze: "双击固定为独立窗口"
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
    quickActions: "快捷操作", action1: "拖动标题栏移动窗口", action2: "右下角调整大小", action3: "点击「原文」显示原文对照", action4: "点击「复制」或直接选中文字复制", action5: "按 ESC 或右键关闭",
    // 划词翻译组件内文案
    translateFailed: "翻译失败",
    noText: "未获取到文字",
    emptyContent: "选中内容为空",
    tooShort: "文字太短（最少 {{min}} 字符）",
    tooLong: "文字太长（最多 {{max}} 字符）",
    noValidText: "选中内容无有效文字",
    possibleGarbage: "选中内容可能是乱码",
    isFilePath: "选中内容是文件路径",
    emptyResult: "翻译结果为空",
    frozenHint: "已固定 - 右键点击关闭",
    showSource: "显示原文",
    copyTarget: "复制译文",
    closeEsc: "关闭 (ESC)"
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
      defaultSource: "默认源语言", defaultTarget: "默认目标语言",
      langSwitched: "界面语言已切换"
    },
    startup: {
      title: "启动",
      autoLaunch: "开机自启动",
      autoLaunchHint: "系统启动时自动在后台运行，不弹出主窗口",
      autoLaunchEnabled: "已开启开机自启动",
      autoLaunchDisabled: "已关闭开机自启动",
      autoLaunchFailed: "设置自启动失败",
      autoSelection: "启动后自动开启划词翻译",
      autoSelectionHint: "开机自启后自动开启划词翻译，选中文字即可翻译",
    },
    providers: {
      title: "翻译源设置", enable: "启用", disable: "禁用", test: "测试连接", testing: "测试中...", testSuccess: "连接成功", testFailed: "连接失败",
      priority: "优先级", priorityDesc: "拖拽调整翻译源优先级", apiKey: "API Key", apiKeyPlaceholder: "请输入 API Key", baseUrl: "API 地址", model: "模型", getKey: "获取 Key",
      localLlm: { name: "本地 LLM", desc: "使用本地大模型翻译，完全离线", endpoint: "API 端点", endpointPlaceholder: "http://localhost:1234/v1" },
      openai: { name: "OpenAI", desc: "使用 GPT 模型翻译" }, deepl: { name: "DeepL", desc: "高质量翻译服务" },
      gemini: { name: "Gemini", desc: "Google AI 翻译" }, deepseek: { name: "DeepSeek", desc: "国产大模型翻译" }, google: { name: "Google 翻译", desc: "Google 免费翻译服务" }
    },
    ocr: { title: "OCR 设置", engine: "OCR 引擎", engineDesc: "选择文字识别引擎", engines: { rapid: "RapidOCR（本地）", windows: "Windows OCR", llmVision: "LLM Vision" }, language: "识别语言", languageDesc: "选择要识别的语言" },
    shortcuts: { title: "快捷键设置", desc: "自定义全局快捷键", showWindow: "显示/隐藏主窗口", screenshot: "截图翻译", glassWindow: "玻璃窗口", selectionToggle: "开启/关闭划词翻译", recording: "按下快捷键...", conflict: "快捷键冲突", reset: "重置默认" },
    privacy: {
      title: "隐私设置", mode: "隐私模式", modeDesc: "控制数据存储和网络请求",
      modes: { standard: "标准模式", standardDesc: "正常功能，记录历史", offline: "离线模式", offlineDesc: "仅使用本地翻译源", incognito: "无痕模式", incognitoDesc: "不记录历史和缓存", strict: "严格模式", strictDesc: "离线 + 无痕" },
      clearHistory: "清除历史记录", clearCache: "清除缓存", clearAll: "清除所有数据"
    },
    tts: { title: "语音设置", enable: "启用 TTS", enableDesc: "开启翻译结果语音朗读", voice: "语音", voiceDesc: "选择朗读语音", rate: "语速", rateDesc: "调整朗读速度", pitch: "音调", pitchDesc: "调整语音音调", volume: "音量", volumeDesc: "调整朗读音量", test: "测试", testText: "这是一段测试文本" },
    glossary: { title: "术语表", desc: "自定义翻译术语，确保专业词汇翻译一致", add: "添加术语", source: "原文", target: "译文", empty: "暂无术语", import: "导入", export: "导出", delete: "删除", save: "保存" },
    about: { title: "关于", version: "版本", checkUpdate: "检查更新", checking: "检查中...", upToDate: "已是最新版本", newVersion: "发现新版本", download: "前往下载", later: "稍后再说", releaseNotes: "更新内容", publishedAt: "发布时间", github: "GitHub", feedback: "反馈问题", license: "开源协议", copyright: "© 2026 T-Translate" },
    selection: { title: "划词翻译" },
    glass: { title: "玻璃窗口" }
  },
  about: {
    desc: "智能离线翻译工具",
    features: "核心特性",
    feature1: "本地 LLM 翻译，数据不出设备",
    feature2: "多引擎 OCR 文字识别",
    feature3: "PDF/DOCX/EPUB 文档翻译",
    feature4: "划词翻译 + 玻璃窗口",
    techStack: "技术栈",
    openLogs: "打开日志目录",
    logDirOpened: "已打开日志目录",
    logDirFailed: "无法打开日志目录",
    updateUnavailable: "检查更新功能不可用",
    updateFailed: "检查更新失败",
    noReleases: "暂无发布版本，已是最新",
    currentVersion: "当前版本",
    latestVersion: "最新版本",
    downloading: "正在下载...",
    downloadReady: "下载完成，准备安装",
    downloadComplete: "下载完成",
    installHint: "点击下方按钮将启动安装程序并关闭应用",
    launching: "正在启动安装程序...",
    installNow: "立即安装",
    installFailed: "安装失败",
    manualDownload: "手动下载",
    downloadInstall: "下载并安装",
    githubHint: "你也可以手动前往 GitHub 下载"
  },
  notify: { 
    success: "成功", error: "错误", warning: "警告", info: "提示", 
    copySuccess: "已复制到剪贴板", copyFailed: "复制失败", 
    saveSuccess: "保存成功", saveFailed: "保存失败", 
    networkError: "网络错误", translateError: "翻译失败", ocrError: "识别失败", 
    shortcutRegistered: "快捷键已注册", shortcutConflict: "快捷键冲突"
  },
  guide: {
    subtitle: "快速了解核心功能",
    dismiss: "不再显示",
    selection: { title: "划词翻译", desc: "选中任意文字，自动弹出翻译" },
    screenshot: { title: "截图翻译", desc: "框选屏幕区域，OCR 识别并翻译" },
    glass: { title: "玻璃悬浮窗", desc: "透明窗口覆盖在原文上方，实时翻译" },
    document: { title: "文档翻译", desc: "拖入文件，逐段翻译并导出双语对照" },
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
    llmVision: {
      notSupported: "当前模型不支持图片识别，请加载支持视觉的模型（如 Qwen-VL、LLaVA 等）",
      noText: "未识别到文字",
      timeout: "OCR 识别超时，请检查模型是否支持视觉功能"
    },
    visionFallback: "当前模型不支持视觉识别，已自动切换到本地 OCR",
    visionLocked: "LLM 视觉识别已因多次失败被禁用，已切换到本地 OCR。如需重新启用请前往 设置 > OCR",
    allEnginesFailed: "所有 OCR 引擎均失败"
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
    langNames: { zh: "中文", en: "英语", ja: "日语", ko: "韩语", fr: "法语", de: "德语", es: "西班牙语", ru: "俄语", pt: "葡萄牙语", it: "意大利语" },
    noVoicesInstalled: "系统未安装任何语音包，请在系统设置中安装语音",
    noVoiceForLang: "系统未安装{{lang}}语音包"
  },
  // ========== 新增：文档翻译组件翻译键 ==========
  documentTranslator: {
    title: "文档翻译",
    sourceLang: "源语言",
    targetLang: "目标语言",
    newDocument: "清空",
    formats: {
      "纯文本": "纯文本", "Markdown": "Markdown", "SRT 字幕": "SRT 字幕", "WebVTT 字幕": "WebVTT 字幕",
      "PDF 文档": "PDF 文档", "Word 文档": "Word 文档", "CSV 表格": "CSV 表格", "JSON 文件": "JSON 文件", "EPUB 电子书": "EPUB 电子书"
    },
    // 搜索替换
    search: {
      title: "搜索",
      searchPlaceholder: "搜索段落内容...",
      replacePlaceholder: "替换为...",
      replaceAll: "全部替换",
      replaceThis: "替换当前",
      matches: "个匹配",
      prev: "上一个",
      next: "下一个"
    },
    // 段落
    segment: {
      edited: "译文已修改",
      retranslate: "重新翻译",
      edit: "编辑译文",
      copy: "复制译文",
      save: "保存",
      cancel: "取消"
    },
    // 进度恢复
    restore: {
      found: "发现上次的翻译进度（{{count}} 条已译）",
      restore: "恢复进度",
      dismiss: "忽略"
    },
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
      cacheCleared: "翻译记忆缓存已清除",
      scannedNoOcr: "该 PDF 为扫描件，无法提取文字。请在设置中配置 OCR 引擎后重试",
      ocrUsed: "OCR 识别",
      fileTooLarge: "文件过大，最大支持 20MB",
      pdfHint: "PDF 仅提取文字内容，图片及复杂排版可能丢失，建议使用纯文本格式"
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
      cached: "缓存",
      edited: "已修改译文",
      editedHint: "点击定位到已修改的译文"
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
  // ========== 错误边界 ==========
  errorBoundary: {
    title: "出现了一些问题",
    windowError: "{{name}}出现了问题",
    description: "应用遇到了错误，请尝试重试或刷新页面",
    retry: "重试",
    reload: "刷新页面",
    details: "错误详情"
  },
  // ========== 新增：托盘菜单翻译键 ==========
  titleBar: {
    minimize: "最小化", maximize: "最大化", restore: "还原", close: "关闭"
  },
  errors: {
    network: { title: "网络连接失败", message: "无法连接到翻译服务", s1: "检查网络连接是否正常", s2: "如果使用本地 LLM，请确保 LM Studio 正在运行", s3: "检查防火墙设置是否阻止了连接" },
    apiKey: { title: "API 密钥无效", message: "API 密钥未配置或已失效", s1: "检查 API Key 是否正确输入", s2: "确认 API Key 没有过期", s3: "前往设置页面重新配置" },
    quota: { title: "请求次数超限", message: "API 调用次数已达上限", s1: "稍后再试", s2: "切换到其他翻译源", s3: "检查 API 账户配额" },
    timeout: { title: "请求超时", message: "翻译服务响应时间过长", s1: "网络可能较慢，请稍后重试", s2: "如果使用本地 LLM，模型可能正在加载", s3: "尝试翻译较短的文本" },
    config: { title: "配置错误", message: "翻译源配置不正确", s1: "检查 API 地址是否正确", s2: "确认翻译源已正确配置" },
    provider: { title: "翻译源不可用", message: "当前翻译源暂时无法使用", s1: "尝试切换到其他翻译源", s2: "检查翻译源配置" },
    ocr: { title: "OCR 识别失败", message: "文字识别出现问题", s1: "确保图片清晰且包含文字", s2: "尝试调整截图区域", s3: "切换其他 OCR 引擎" },
    unknown: { title: "操作失败", message: "发生未知错误", s1: "请稍后重试", s2: "如果问题持续，请检查设置" },
    openSettings: "打开设置", switchProvider: "切换翻译源", retry: "重试", checkSettings: "检查设置",
    p: {
      localLlm: { network: "LM Studio 未运行或无法连接。请确保 LM Studio 已启动并加载了模型。", config: "请检查 LM Studio 地址配置（默认 http://localhost:1234）" },
      openai: { apiKey: "OpenAI API Key 无效。请在设置中检查您的 API Key。", quota: "OpenAI API 配额已用尽。请检查您的账户余额。" },
      deepl: { apiKey: "DeepL API Key 无效。请确认使用的是 API Key 而非账户密码。", quota: "DeepL 免费版配额已用尽。考虑升级或切换翻译源。" },
      gemini: { apiKey: "Gemini API Key 无效。请前往 Google AI Studio 获取有效的 Key。" },
      deepseek: { apiKey: "DeepSeek API Key 无效。请检查配置。" },
      google: { network: "Google 翻译服务暂时无法访问。可能需要网络代理。" }
    }
  },
  svc: {
    noProvider: "没有可用的翻译源",
    allFailed: "所有翻译源均失败",
    batchFailed: "批量翻译全部失败",
    noUserMsg: "没有用户消息",
    translateFailed: "翻译失败",
    providerNotFound: "翻译源不存在",
    missingConfig: "缺少配置",
    connected: "连接成功",
    testFailed: "测试失败",
    connectFailed: "连接失败",
    ocrFailed: "OCR 失败",
    noTextRecognized: "（未识别到文字）",
    noValidTextRecognized: "（未识别到有效文字）"
  },
  docParser: {
    emptySegment: "空段落", tooShort: "过短", numbersOnly: "纯数字",
    codeBlock: "代码块", alreadyTargetLang: "已是目标语言", containsKeyword: "包含关键词",
    epubNoContainer: "无效的 EPUB 文件：缺少 container.xml",
    epubNoRootfile: "无效的 EPUB 文件：找不到 rootfile",
    epubNoOpf: "无效的 EPUB 文件：找不到 OPF 文件",
    epubNoContent: "EPUB 文件中没有找到可翻译的文本内容",
    unsupportedFormat: "不支持的文件格式",
    passwordRequired: "文件需要密码",
    readFailed: "文件读取失败"
  },
  glossary: {
    unsupportedJson: "不支持的 JSON 格式",
    jsonParseFailed: "JSON 解析失败",
    csvEmpty: "CSV 文件为空或格式错误",
    unknownFormat: "无法识别文件格式，请使用 JSON、CSV 或 TBX 格式"
  },
  docParser: {
    emptySegment: "空段落", tooShort: "过短", numbersOnly: "纯数字", codeBlock: "代码块",
    alreadyTargetLang: "已是目标语言", containsKeyword: "包含关键词",
    unsupportedFormat: "不支持的文件格式", unimplementedParser: "未实现的解析器",
    passwordRequired: "文件需要密码", readFailed: "文件读取失败",
    invalidEpubContainer: "无效的 EPUB 文件：缺少 container.xml",
    invalidEpubRootfile: "无效的 EPUB 文件：找不到 rootfile",
    invalidEpubOpf: "无效的 EPUB 文件：找不到 OPF 文件",
    epubEmpty: "EPUB 文件中没有找到可翻译的文本内容"
  },
  tray: {
    showWindow: "显示窗口",
    screenshot: "截图翻译",
    glassWindow: "玻璃窗口",
    selectionTranslate: "划词翻译",
    alwaysOnTop: "置顶",
    quit: "退出"
  }
};

export default zh;
