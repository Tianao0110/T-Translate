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
    'ocr.cantGetLangs': '无法获取语言列表',
    
    // OCR download / install
    'ocr.unknownEngine': '未知的引擎 ID',
    'ocr.cantFindPath': '无法确定安装路径，请手动在项目目录运行: npm install ',
    'ocr.npmUnavailable': 'npm 不可用，请确保已安装 Node.js 并添加到环境变量',
    'ocr.downloading': '正在下载 {{name}}...',
    'ocr.installing': '正在安装依赖...',
    'ocr.installDone': '安装完成！',
    'ocr.installSuccess': '{{name}} 安装成功',
    'ocr.restartHint': '为确保 OCR 引擎正常工作，建议重启应用',
    
    // OCR uninstall
    'ocr.builtinEngine': 'LLM Vision 是内置引擎，无法卸载',
    'ocr.systemEngine': 'Windows OCR 是系统引擎，无法卸载',
    'ocr.cantRemove': '无法删除该引擎',
    'ocr.notInstalled': '该引擎未安装',
    'ocr.keepOneLocal': '无法卸载：必须保留至少一个本地 OCR 引擎',
    'ocr.cantFindUninstallPath': '无法确定卸载路径',
    'ocr.uninstalled': '{{name}} 已卸载',
    'ocr.uninstallFailed': '卸载失败',
    
    // OCR health check
    'ocr.moduleMissing': 'OCR 引擎模块未安装或已损坏',
    'ocr.moduleCorrupt': 'OCR 模块加载异常，无法创建实例',
    'ocr.instanceFailed': 'OCR 实例创建失败，模型文件可能损坏',
    'ocr.engineHealthy': 'OCR 引擎运行正常',
    'ocr.loadFailed': 'OCR 引擎加载失败: {{detail}}',
    'ocr.llmBuiltin': 'LLM Vision 是内置引擎',
    'ocr.winOcrAvailable': 'Windows OCR 可用',
    'ocr.onlineNoCheck': '在线引擎无需健康检查',
    
    // OCR repair
    'ocr.repairOnlyRapid': '仅支持修复 RapidOCR 引擎',
    'ocr.repairCantFindPath': '无法确定安装路径，请手动运行: npm install @gutenye/ocr-node',
    'ocr.repairChecking': '正在检查环境...',
    'ocr.repairUninstalling': '正在卸载损坏的引擎...',
    'ocr.repairDownloading': '正在重新下载 OCR 引擎...',
    'ocr.repairVerifying': '正在验证安装...',
    'ocr.repairDone': '修复完成！',
    'ocr.repairSuccess': 'RapidOCR 修复成功',
    'ocr.repairRestartHint': '为确保修复生效，请重启应用',
    
    // OCR recognition
    'ocr.winOnlyWindows': 'Windows OCR 仅在 Windows 系统上可用',
    'ocr.winOcrFailed': 'Windows OCR 识别失败',
    'ocr.paddleLoadFailed': 'PaddleOCR 引擎加载失败: {{detail}}',
    'ocr.noApiKey': '未配置 {{service}} API Key',
    'ocr.noApiKeySecret': '未配置百度 OCR API Key',
    'ocr.baiduTokenFailed': '获取百度 access_token 失败',
    'ocr.ocrspaceFailed': 'OCR.space 处理失败',
    'ocr.baiduFailed': '百度 OCR 失败',
    
    // formatError
    'ocr.npmNotFound': 'npm 命令未找到，请确保已安装 Node.js',
    'ocr.downloadTimeout': '下载超时，请检查网络连接后重试',
    'ocr.permissionDenied': '权限不足，请以管理员身份运行',
    'ocr.downloadFailed': '下载失败',
    'ocr.invalidImageData': '无效的图片数据格式',
    
    // shortcuts
    'shortcuts.occupied': '快捷键已被占用',
    'shortcuts.resumeFailed': '快捷键恢复失败',
    
    // system
    'system.checkUpdateFailed': '检查更新失败',
    'system.alreadyDownloading': '已在下载中',
    'system.downloadFailed': '下载失败',
    'system.installFailed': '安装失败',
    'system.logDirFailed': '无法获取日志目录',
    'system.connectionOk': '连接正常',
    'system.serverStatus': '服务器返回',
    'system.timeout': '连接超时',
    'system.cannotConnect': '无法连接服务',
    
    // glass
    'glass.windowNotFound': '玻璃窗口不存在',
    
    // screenshot
    'screenshot.failed': '截图失败',
    'screenshot.visionNotSupported': '当前模型不支持图片识别，请加载视觉模型（如 Qwen-VL、LLaVA）',
    'screenshot.ocrTimeout': 'OCR 识别超时，请检查模型是否正常运行',
    'screenshot.ocrFailed': 'OCR 识别失败',
    'screenshot.ocrError': 'OCR 错误',
    'screenshot.noImage': '没有预先截取的屏幕图像',
    'screenshot.noSource': '没有可用的截图源',
    
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
    'ocr.cantGetLangs': 'Unable to get language list',
    
    // OCR download/install
    'ocr.unknownEngine': 'Unknown engine ID',
    'ocr.cantFindPath': 'Cannot determine install path. Please run manually: npm install ',
    'ocr.npmUnavailable': 'npm is not available. Please ensure Node.js is installed and in PATH.',
    'ocr.downloading': 'Downloading {{name}}...',
    'ocr.installing': 'Installing dependencies...',
    'ocr.installDone': 'Installation complete!',
    'ocr.installSuccess': '{{name}} installed successfully',
    'ocr.restartHint': 'Restart recommended to ensure the OCR engine works properly',
    
    // OCR uninstall
    'ocr.builtinEngine': 'LLM Vision is a built-in engine and cannot be uninstalled',
    'ocr.systemEngine': 'Windows OCR is a system engine and cannot be uninstalled',
    'ocr.cantRemove': 'Cannot remove this engine',
    'ocr.notInstalled': 'This engine is not installed',
    'ocr.keepOneLocal': 'Cannot uninstall: at least one local OCR engine must be kept',
    'ocr.cantFindUninstallPath': 'Cannot determine uninstall path',
    'ocr.uninstalled': '{{name}} has been uninstalled',
    'ocr.uninstallFailed': 'Uninstall failed',
    
    // OCR health check
    'ocr.moduleMissing': 'OCR engine module is not installed or corrupted',
    'ocr.moduleCorrupt': 'OCR module loaded abnormally, cannot create instance',
    'ocr.instanceFailed': 'OCR instance creation failed, model files may be corrupted',
    'ocr.engineHealthy': 'OCR engine is running normally',
    'ocr.loadFailed': 'OCR engine failed to load: {{detail}}',
    'ocr.llmBuiltin': 'LLM Vision is a built-in engine',
    'ocr.winOcrAvailable': 'Windows OCR is available',
    'ocr.onlineNoCheck': 'Online engines do not need health checks',
    
    // OCR repair
    'ocr.repairOnlyRapid': 'Only RapidOCR engine repair is supported',
    'ocr.repairCantFindPath': 'Cannot determine install path. Please run manually: npm install @gutenye/ocr-node',
    'ocr.repairChecking': 'Checking environment...',
    'ocr.repairUninstalling': 'Uninstalling corrupted engine...',
    'ocr.repairDownloading': 'Re-downloading OCR engine...',
    'ocr.repairVerifying': 'Verifying installation...',
    'ocr.repairDone': 'Repair complete!',
    'ocr.repairSuccess': 'RapidOCR repaired successfully',
    'ocr.repairRestartHint': 'Please restart the application to apply the fix',
    
    // OCR recognition
    'ocr.winOnlyWindows': 'Windows OCR is only available on Windows',
    'ocr.winOcrFailed': 'Windows OCR recognition failed',
    'ocr.paddleLoadFailed': 'PaddleOCR engine failed to load: {{detail}}',
    'ocr.noApiKey': '{{service}} API Key is not configured',
    'ocr.noApiKeySecret': 'Baidu OCR API Key is not configured',
    'ocr.baiduTokenFailed': 'Failed to obtain Baidu access_token',
    'ocr.ocrspaceFailed': 'OCR.space processing failed',
    'ocr.baiduFailed': 'Baidu OCR failed',
    
    // formatError
    'ocr.npmNotFound': 'npm command not found. Please ensure Node.js is installed.',
    'ocr.downloadTimeout': 'Download timed out. Please check your network and try again.',
    'ocr.permissionDenied': 'Permission denied. Please run as administrator.',
    'ocr.downloadFailed': 'Download failed',
    'ocr.invalidImageData': 'Invalid image data format',
    
    // shortcuts
    'shortcuts.occupied': 'Shortcut is already in use',
    'shortcuts.resumeFailed': 'Failed to restore shortcut',
    
    // system
    'system.checkUpdateFailed': 'Failed to check for updates',
    'system.alreadyDownloading': 'Already downloading',
    'system.downloadFailed': 'Download failed',
    'system.installFailed': 'Installation failed',
    'system.logDirFailed': 'Cannot access log directory',
    'system.connectionOk': 'Connection OK',
    'system.serverStatus': 'Server returned',
    'system.timeout': 'Connection timed out',
    'system.cannotConnect': 'Cannot connect to service',
    
    // glass
    'glass.windowNotFound': 'Glass window not found',
    
    // screenshot
    'screenshot.failed': 'Screenshot failed',
    'screenshot.visionNotSupported': 'Current model does not support image recognition. Please load a vision model (e.g. Qwen-VL, LLaVA).',
    'screenshot.ocrTimeout': 'OCR recognition timed out. Please check if the model is running.',
    'screenshot.ocrFailed': 'OCR recognition failed',
    'screenshot.ocrError': 'OCR Error',
    'screenshot.noImage': 'No pre-captured screen image',
    'screenshot.noSource': 'No screenshot source available',
    
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
