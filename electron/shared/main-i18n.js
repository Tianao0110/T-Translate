// electron/shared/main-i18n.js
// 主进程国际化模块
// 由于主进程无法使用 react-i18next，维护独立翻译表
// 语言检测复用 tray-labels 的 getLanguage()

const { getLanguage } = require('./tray-labels');

const messages = {
  zh: {
    // OCR 引擎检测
    'ocr.notWindows': '非 Windows 系统',
    'ocr.needsWin10': '需要 Windows 10 或更高版本',
    'ocr.noLangPack': '未安装任何 OCR 语言包',
    'ocr.cantGetLangs': '无法获取语言列表',
    
    // OCR 下载/安装
    'ocr.unknownEngine': '未知的引擎 ID',
    'ocr.cantFindPath': '无法确定安装路径，请手动在项目目录运行: npm install ',
    'ocr.npmUnavailable': 'npm 不可用，请确保已安装 Node.js 并添加到环境变量',
    'ocr.downloading': '正在下载 {{name}}...',
    'ocr.installing': '正在安装依赖...',
    'ocr.installDone': '安装完成！',
    'ocr.installSuccess': '{{name}} 安装成功',
    'ocr.restartHint': '为确保 OCR 引擎正常工作，建议重启应用',
    
    // OCR 卸载
    'ocr.builtinEngine': 'LLM Vision 是内置引擎，无法卸载',
    'ocr.systemEngine': 'Windows OCR 是系统引擎，无法卸载',
    'ocr.cantRemove': '无法删除该引擎',
    'ocr.notInstalled': '该引擎未安装',
    'ocr.keepOneLocal': '无法卸载：必须保留至少一个本地 OCR 引擎',
    'ocr.cantFindUninstallPath': '无法确定卸载路径',
    'ocr.uninstalled': '{{name}} 已卸载',
    'ocr.uninstallFailed': '卸载失败',
    
    // OCR 健康检查
    'ocr.moduleMissing': 'OCR 引擎模块未安装或已损坏',
    'ocr.moduleCorrupt': 'OCR 模块加载异常，无法创建实例',
    'ocr.instanceFailed': 'OCR 实例创建失败，模型文件可能损坏',
    'ocr.engineHealthy': 'OCR 引擎运行正常',
    'ocr.loadFailed': 'OCR 引擎加载失败: {{detail}}',
    'ocr.llmBuiltin': 'LLM Vision 是内置引擎',
    'ocr.winOcrAvailable': 'Windows OCR 可用',
    'ocr.onlineNoCheck': '在线引擎无需健康检查',
    
    // OCR 修复
    'ocr.repairOnlyRapid': '仅支持修复 RapidOCR 引擎',
    'ocr.repairCantFindPath': '无法确定安装路径，请手动运行: npm install @gutenye/ocr-node',
    'ocr.repairChecking': '正在检查环境...',
    'ocr.repairUninstalling': '正在卸载损坏的引擎...',
    'ocr.repairDownloading': '正在重新下载 OCR 引擎...',
    'ocr.repairVerifying': '正在验证安装...',
    'ocr.repairDone': '修复完成！',
    'ocr.repairSuccess': 'RapidOCR 修复成功',
    'ocr.repairRestartHint': '为确保修复生效，请重启应用',
    
    // OCR 识别
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
  },
};

/**
 * 翻译主进程文案
 * @param {string} key - 翻译 key
 * @param {Object} params - 模板参数 {{name}} 等
 * @returns {string}
 */
function t(key, params = {}) {
  const lang = getLanguage();
  let text = messages[lang]?.[key] || messages.zh[key] || key;
  
  // 替换模板参数
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
  }
  
  return text;
}

module.exports = { t, messages };
