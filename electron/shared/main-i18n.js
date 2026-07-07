// Main-process i18n.
// react-i18next is renderer-only; the main process maintains its own translation table.
// Language detection reuses tray-labels' getLanguage().

const { getLanguage } = require('./tray-labels');

const messages = {
  zh: {
    // OCR engine detection
    'ocr.notWindows': '非 Windows 系统',
    'ocr.needsWin10': '需要 Windows 10 或更高版本',
    'ocr.noLangPack': '未安装任何 OCR 语言包',
    
    // OCR health check
    'ocr.engineHealthy': 'OCR 引擎运行正常',
    'ocr.loadFailed': 'OCR 引擎加载失败: {{detail}}',
    'ocr.baseModelsMissing': '本地 OCR 模型文件缺失，请在设置中重新下载基础模型',
    'ocr.llmBuiltin': 'LLM Vision 是内置引擎',
    'ocr.winOcrAvailable': 'Windows OCR 可用',
    'ocr.onlineNoCheck': '在线引擎无需健康检查',

    // OCR recognition
    'ocr.winOnlyWindows': 'Windows OCR 仅在 Windows 系统上可用',
    'ocr.noApiKey': '未配置 {{service}} API Key',
    'ocr.noApiKeySecret': '未配置百度 OCR API Key',
    'ocr.baiduTokenFailed': '获取百度 access_token 失败',
    'ocr.ocrspaceFailed': 'OCR.space 处理失败',
    'ocr.baiduFailed': '百度 OCR 失败',
    
    // shortcuts
    'shortcuts.occupied': '快捷键已被占用',
    'shortcuts.resumeFailed': '快捷键恢复失败',
    'shortcuts.needsModifier': '全局快捷键需包含 Ctrl、Alt 或 Win 键（F1-F24 可单独使用）',
    
    // system
    'system.checkUpdateFailed': '检查更新失败',
    'system.offlineUpdateBlocked': '离线模式下已禁用检查更新',
    'system.alreadyDownloading': '已在下载中',
    'system.downloadFailed': '下载失败',
    'system.installFailed': '安装失败',
    'system.logDirFailed': '无法获取日志目录',
    'system.connectionOk': '连接正常',
    'system.serverStatus': '服务器返回',
    'system.timeout': '连接超时',
    'system.cannotConnect': '无法连接服务',
    
    // floating window
    'floatingWindow.notFound': '悬浮窗口不存在',
    
    // screenshot
    'screenshot.failed': '截图失败',
    'screenshot.visionNotSupported': '当前模型不支持图片识别，请加载视觉模型（如 Qwen-VL、LLaVA）',
    'screenshot.ocrTimeout': 'OCR 识别超时，请检查模型是否正常运行',
    'screenshot.ocrFailed': 'OCR 识别失败',
    'screenshot.ocrError': 'OCR 错误',
    'screenshot.noImage': '没有预先截取的屏幕图像',
    'screenshot.noSource': '没有可用的截图源',
    'selection.loadingTimeout': '识别超时，请重试',
    
    // menu
    'menu.file': '文件', 'menu.edit': '编辑', 'menu.view': '视图',
    'menu.translate': '翻译', 'menu.settings': '设置', 'menu.help': '帮助',
    'menu.about': '关于', 'menu.preferences': '偏好设置',
    'menu.hide': '隐藏', 'menu.hideOthers': '隐藏其他', 'menu.showAll': '显示全部',
    'menu.quit': '退出',
    'menu.newTranslation': '新建翻译', 'menu.importText': '导入文本',
    'menu.exportTranslation': '导出翻译',
    'menu.textFiles': '文本文件', 'menu.allFiles': '所有文件',
    'menu.undo': '撤销', 'menu.redo': '重做',
    'menu.cut': '剪切', 'menu.copy': '复制', 'menu.paste': '粘贴', 'menu.selectAll': '全选',
    'menu.reload': '重新加载', 'menu.devTools': '开发者工具',
    'menu.actualSize': '实际大小', 'menu.zoomIn': '放大', 'menu.zoomOut': '缩小',
    'menu.fullscreen': '全屏', 'menu.alwaysOnTop': '置顶',
    'menu.screenshotTranslate': '截图翻译', 'menu.quickTranslate': '快速翻译',
    'menu.switchLang': '切换语言', 'menu.clearContent': '清空内容',
    'menu.lmStudioSettings': 'LM Studio 设置', 'menu.ocrSettings': 'OCR 设置',
    'menu.userGuide': '使用指南', 'menu.shortcutList': '快捷键列表',
    'menu.checkUpdate': '检查更新', 'menu.upToDate': '当前已是最新版本',
    'menu.ok': '确定',
    'menu.aboutDetail': '版本: {{version}}\n离线翻译工具\n\n基于 LM Studio 和本地 OCR',
  },
  en: {
    // OCR engine detection
    'ocr.notWindows': 'Not a Windows system',
    'ocr.needsWin10': 'Requires Windows 10 or later',
    'ocr.noLangPack': 'No OCR language packs installed',
    
    // OCR health check
    'ocr.engineHealthy': 'OCR engine is running normally',
    'ocr.loadFailed': 'OCR engine failed to load: {{detail}}',
    'ocr.baseModelsMissing': 'Local OCR model files are missing. Re-download the base models in Settings.',
    'ocr.llmBuiltin': 'LLM Vision is a built-in engine',
    'ocr.winOcrAvailable': 'Windows OCR is available',
    'ocr.onlineNoCheck': 'Online engines do not need health checks',

    // OCR recognition
    'ocr.winOnlyWindows': 'Windows OCR is only available on Windows',
    'ocr.noApiKey': '{{service}} API Key is not configured',
    'ocr.noApiKeySecret': 'Baidu OCR API Key is not configured',
    'ocr.baiduTokenFailed': 'Failed to obtain Baidu access_token',
    'ocr.ocrspaceFailed': 'OCR.space processing failed',
    'ocr.baiduFailed': 'Baidu OCR failed',
    
    // shortcuts
    'shortcuts.occupied': 'Shortcut is already in use',
    'shortcuts.resumeFailed': 'Failed to restore shortcut',
    'shortcuts.needsModifier': 'Global shortcuts must include Ctrl, Alt or Win (F1-F24 may be used alone)',
    
    // system
    'system.checkUpdateFailed': 'Failed to check for updates',
    'system.offlineUpdateBlocked': 'Update checks are disabled in offline mode',
    'system.alreadyDownloading': 'Already downloading',
    'system.downloadFailed': 'Download failed',
    'system.installFailed': 'Installation failed',
    'system.logDirFailed': 'Cannot access log directory',
    'system.connectionOk': 'Connection OK',
    'system.serverStatus': 'Server returned',
    'system.timeout': 'Connection timed out',
    'system.cannotConnect': 'Cannot connect to service',
    
    // floating window
    'floatingWindow.notFound': 'Floating window not found',
    
    // screenshot
    'screenshot.failed': 'Screenshot failed',
    'screenshot.visionNotSupported': 'Current model does not support image recognition. Please load a vision model (e.g. Qwen-VL, LLaVA).',
    'screenshot.ocrTimeout': 'OCR recognition timed out. Please check if the model is running.',
    'screenshot.ocrFailed': 'OCR recognition failed',
    'screenshot.ocrError': 'OCR Error',
    'screenshot.noImage': 'No pre-captured screen image',
    'screenshot.noSource': 'No screenshot source available',
    'selection.loadingTimeout': 'Recognition timed out, please try again',
    
    // menu
    'menu.file': 'File', 'menu.edit': 'Edit', 'menu.view': 'View',
    'menu.translate': 'Translate', 'menu.settings': 'Settings', 'menu.help': 'Help',
    'menu.about': 'About', 'menu.preferences': 'Preferences',
    'menu.hide': 'Hide', 'menu.hideOthers': 'Hide Others', 'menu.showAll': 'Show All',
    'menu.quit': 'Quit',
    'menu.newTranslation': 'New Translation', 'menu.importText': 'Import Text',
    'menu.exportTranslation': 'Export Translation',
    'menu.textFiles': 'Text Files', 'menu.allFiles': 'All Files',
    'menu.undo': 'Undo', 'menu.redo': 'Redo',
    'menu.cut': 'Cut', 'menu.copy': 'Copy', 'menu.paste': 'Paste', 'menu.selectAll': 'Select All',
    'menu.reload': 'Reload', 'menu.devTools': 'Developer Tools',
    'menu.actualSize': 'Actual Size', 'menu.zoomIn': 'Zoom In', 'menu.zoomOut': 'Zoom Out',
    'menu.fullscreen': 'Fullscreen', 'menu.alwaysOnTop': 'Always on Top',
    'menu.screenshotTranslate': 'Screenshot Translate', 'menu.quickTranslate': 'Quick Translate',
    'menu.switchLang': 'Switch Language', 'menu.clearContent': 'Clear Content',
    'menu.lmStudioSettings': 'LM Studio Settings', 'menu.ocrSettings': 'OCR Settings',
    'menu.userGuide': 'User Guide', 'menu.shortcutList': 'Keyboard Shortcuts',
    'menu.checkUpdate': 'Check for Updates', 'menu.upToDate': 'You are up to date',
    'menu.ok': 'OK',
    'menu.aboutDetail': 'Version: {{version}}\nOffline Translation Tool\n\nPowered by LM Studio and Local OCR',
  },
};

// Translate a main-process string. Supports {{param}} placeholders.
function t(key, params = {}) {
  const lang = getLanguage();
  let text = messages[lang]?.[key] || messages.zh[key] || key;

  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
  }

  return text;
}

module.exports = { t, messages };
