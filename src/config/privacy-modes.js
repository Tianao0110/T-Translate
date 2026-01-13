// src/config/privacy-modes.js
// 隐私模式全局配置
// 这是应用的核心状态之一，影响所有功能模块

/**
 * 隐私模式定义
 * 每种模式下的功能限制和行为规则
 */
export const PRIVACY_MODES = {
  standard: {
    id: 'standard',
    name: '标准模式',
    icon: 'Zap',
    color: '#3b82f6',
    description: '功能全开，自动保存历史记录',
    features: {
      saveHistory: true,        // 保存历史记录
      useCache: true,           // 使用翻译缓存
      onlineApi: true,          // 允许在线API
      analytics: true,          // 统计数据
      autoSave: true,           // 自动保存设置
      selectionTranslate: true, // 划词翻译
      glassWindow: true,        // 玻璃窗口
      documentTranslate: true,  // 文档翻译
      exportData: true,         // 导出数据
      ocr: true,                // OCR功能
    },
    allowedProviders: null,     // null表示全部允许
    allowedOcrEngines: null,    // null表示全部允许
  },
  
  secure: {
    id: 'secure',
    name: '无痕模式',
    icon: 'Shield',
    color: '#f59e0b',
    description: '不保存任何记录，关闭窗口即清除',
    features: {
      saveHistory: false,       // 不保存历史
      useCache: false,          // 不使用缓存（每次都重新翻译）
      onlineApi: true,          // 允许在线API
      analytics: false,         // 不统计数据
      autoSave: false,          // 不自动保存
      selectionTranslate: true, // 划词翻译（但不保存）
      glassWindow: true,        // 玻璃窗口（但不保存）
      documentTranslate: true,  // 文档翻译（但不保存）
      exportData: false,        // 禁止导出（无数据可导出）
      ocr: true,                // OCR功能
    },
    allowedProviders: null,
    allowedOcrEngines: null,
  },
  
  offline: {
    id: 'offline',
    name: '离线模式',
    icon: 'Lock',
    color: '#10b981',
    description: '完全离线，不发送任何网络请求',
    features: {
      saveHistory: true,        // 保存历史
      useCache: true,           // 使用缓存
      onlineApi: false,         // 禁止在线API（核心限制）
      analytics: true,          // 统计数据
      autoSave: true,           // 自动保存
      selectionTranslate: true, // 划词翻译
      glassWindow: true,        // 玻璃窗口
      documentTranslate: true,  // 文档翻译
      exportData: true,         // 允许导出
      ocr: true,                // OCR功能（仅本地）
    },
    // 离线模式下仅允许本地翻译源
    allowedProviders: ['local-llm'],
    // 离线模式下仅允许本地OCR引擎
    allowedOcrEngines: ['llm-vision', 'rapid-ocr', 'windows-ocr'],
    // 离线模式下禁用的在线服务
    disabledServices: [
      'openai', 'deepl', 'gemini', 'deepseek', 'google-translate',
      'ocr-space', 'google-vision', 'azure-ocr', 'baidu-ocr'
    ],
  }
};

/**
 * 获取模式配置
 * @param {string} mode - 模式ID
 * @returns {object} 模式配置
 */
export const getModeConfig = (mode) => {
  return PRIVACY_MODES[mode] || PRIVACY_MODES.standard;
};

/**
 * 获取当前模式的功能配置
 * @param {string} mode - 模式ID
 * @returns {object} 功能配置
 */
export const getModeFeatures = (mode) => {
  return PRIVACY_MODES[mode]?.features || PRIVACY_MODES.standard.features;
};

/**
 * 检查某功能在指定模式下是否可用
 * @param {string} mode - 模式ID
 * @param {string} featureName - 功能名称
 * @returns {boolean} 是否可用
 */
export const isFeatureEnabled = (mode, featureName) => {
  const features = getModeFeatures(mode);
  return features[featureName] !== false;
};

/**
 * 检查某翻译源在指定模式下是否可用
 * @param {string} mode - 模式ID
 * @param {string} providerId - 翻译源ID
 * @returns {boolean} 是否可用
 */
export const isProviderAllowed = (mode, providerId) => {
  const modeConfig = PRIVACY_MODES[mode];
  if (!modeConfig?.allowedProviders) return true; // null表示全部允许
  return modeConfig.allowedProviders.includes(providerId);
};

/**
 * 检查某OCR引擎在指定模式下是否可用
 * @param {string} mode - 模式ID
 * @param {string} engineId - OCR引擎ID
 * @returns {boolean} 是否可用
 */
export const isOcrEngineAllowed = (mode, engineId) => {
  const modeConfig = PRIVACY_MODES[mode];
  if (!modeConfig?.allowedOcrEngines) return true; // null表示全部允许
  return modeConfig.allowedOcrEngines.includes(engineId);
};

/**
 * 获取指定模式下可用的翻译源列表
 * @param {string} mode - 模式ID
 * @param {Array} allProviders - 所有翻译源列表
 * @returns {Array} 可用的翻译源列表
 */
export const getAvailableProviders = (mode, allProviders) => {
  const modeConfig = PRIVACY_MODES[mode];
  if (!modeConfig?.allowedProviders) return allProviders;
  return allProviders.filter(p => modeConfig.allowedProviders.includes(p.id));
};

/**
 * 获取指定模式下可用的OCR引擎列表
 * @param {string} mode - 模式ID
 * @param {Array} allEngines - 所有OCR引擎列表
 * @returns {Array} 可用的OCR引擎列表
 */
export const getAvailableOcrEngines = (mode, allEngines) => {
  const modeConfig = PRIVACY_MODES[mode];
  if (!modeConfig?.allowedOcrEngines) return allEngines;
  return allEngines.filter(e => modeConfig.allowedOcrEngines.includes(e.id));
};

/**
 * 全局快捷键配置
 */
export const GLOBAL_SHORTCUTS = {
  screenshot: {
    id: 'screenshot',
    label: '截图翻译',
    default: 'Alt+Q',
    icon: '📷',
  },
  toggleWindow: {
    id: 'toggleWindow',
    label: '显示/隐藏窗口',
    default: 'Ctrl+Shift+W',
    icon: '🪟',
  },
  glassWindow: {
    id: 'glassWindow',
    label: '玻璃窗口',
    default: 'Ctrl+Alt+G',
    icon: '🔮',
  },
  selectionTranslate: {
    id: 'selectionTranslate',
    label: '划词翻译开关',
    default: 'Ctrl+Shift+T',
    icon: '✏️',
  },
};

/**
 * 应用内快捷键配置
 */
export const APP_SHORTCUTS = {
  translate: {
    id: 'translate',
    label: '执行翻译',
    default: 'Ctrl+Enter',
  },
  swapLanguages: {
    id: 'swapLanguages',
    label: '切换语言',
    default: 'Ctrl+L',
  },
  clear: {
    id: 'clear',
    label: '清空内容',
    default: 'Ctrl+Shift+C',
  },
  paste: {
    id: 'paste',
    label: '粘贴文本',
    default: 'Ctrl+V',
  },
  copy: {
    id: 'copy',
    label: '复制结果',
    default: 'Ctrl+C',
  },
};

export default {
  PRIVACY_MODES,
  getModeConfig,
  getModeFeatures,
  isFeatureEnabled,
  isProviderAllowed,
  isOcrEngineAllowed,
  getAvailableProviders,
  getAvailableOcrEngines,
  GLOBAL_SHORTCUTS,
  APP_SHORTCUTS,
};
