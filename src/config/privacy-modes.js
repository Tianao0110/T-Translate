// src/config/privacy-modes.js
// 隐私模式全局配置
// 这是应用的核心状态之一，影响所有功能模块

// 从桥接层导入基础常量
import { PRIVACY_MODES as PRIVACY_MODE_IDS, PROVIDER_IDS, OCR_ENGINES } from './constants.js';

/**
 * 隐私模式详细配置
 * 每种模式下的功能限制和行为规则
 */
export const PRIVACY_MODES = {
  [PRIVACY_MODE_IDS.STANDARD]: {
    id: PRIVACY_MODE_IDS.STANDARD,
    name: '标准模式',
    icon: 'Zap',
    color: '#3b82f6',
    description: '功能全开，自动保存历史记录',
    features: {
      saveHistory: true,
      useCache: true,
      onlineApi: true,
      analytics: true,
      autoSave: true,
      selectionTranslate: true,
      glassWindow: true,
      documentTranslate: true,
      exportData: true,
      ocr: true,
    },
    allowedProviders: null,
    allowedOcrEngines: null,
  },
  
  [PRIVACY_MODE_IDS.SECURE]: {
    id: PRIVACY_MODE_IDS.SECURE,
    name: '无痕模式',
    icon: 'Shield',
    color: '#f59e0b',
    description: '不保存任何记录，关闭窗口即清除',
    features: {
      saveHistory: false,
      useCache: false,
      onlineApi: true,
      analytics: false,
      autoSave: false,
      selectionTranslate: true,
      glassWindow: true,
      documentTranslate: true,
      exportData: false,
      ocr: true,
    },
    allowedProviders: null,
    allowedOcrEngines: null,
  },
  
  [PRIVACY_MODE_IDS.OFFLINE]: {
    id: PRIVACY_MODE_IDS.OFFLINE,
    name: '离线模式',
    icon: 'Lock',
    color: '#10b981',
    description: '完全离线，不发送任何网络请求',
    features: {
      saveHistory: true,
      useCache: true,
      onlineApi: false,
      analytics: false,
      autoSave: true,
      selectionTranslate: true,
      glassWindow: true,
      documentTranslate: true,
      exportData: true,
      ocr: true,
    },
    allowedProviders: [PROVIDER_IDS.LOCAL_LLM],
    allowedOcrEngines: [OCR_ENGINES.LLM_VISION, OCR_ENGINES.WINDOWS_OCR, OCR_ENGINES.RAPID_OCR],
  },
  
  [PRIVACY_MODE_IDS.STRICT]: {
    id: PRIVACY_MODE_IDS.STRICT,
    name: '严格模式',
    icon: 'ShieldOff',
    color: '#ef4444',
    description: '最高隐私保护，仅本地处理',
    features: {
      saveHistory: false,
      useCache: false,
      onlineApi: false,
      analytics: false,
      autoSave: false,
      selectionTranslate: true,
      glassWindow: true,
      documentTranslate: false,
      exportData: false,
      ocr: true,
    },
    allowedProviders: [PROVIDER_IDS.LOCAL_LLM],
    allowedOcrEngines: [OCR_ENGINES.LLM_VISION, OCR_ENGINES.WINDOWS_OCR],
  },
};

/**
 * 获取指定模式的配置
 */
export function getPrivacyModeConfig(mode) {
  return PRIVACY_MODES[mode] || PRIVACY_MODES[PRIVACY_MODE_IDS.STANDARD];
}

/**
 * 检查某个 Provider 在指定模式下是否可用
 */
export function isProviderAllowed(providerId, mode) {
  const config = PRIVACY_MODES[mode];
  if (!config) return true;
  if (config.allowedProviders === null) return true;
  return config.allowedProviders.includes(providerId);
}

/**
 * 检查某个 OCR 引擎在指定模式下是否可用
 */
export function isOcrEngineAllowed(engineId, mode) {
  const config = PRIVACY_MODES[mode];
  if (!config) return true;
  if (config.allowedOcrEngines === null) return true;
  return config.allowedOcrEngines.includes(engineId);
}

/**
 * 获取指定模式下的功能配置
 */
export function getModeFeatures(mode) {
  return PRIVACY_MODES[mode]?.features || PRIVACY_MODES[PRIVACY_MODE_IDS.STANDARD].features;
}

/**
 * 检查某功能在指定模式下是否可用
 */
export function isFeatureEnabled(mode, featureName) {
  const features = getModeFeatures(mode);
  return features[featureName] !== false;
}

// 重新导出常量 ID（便于直接使用）
export { PRIVACY_MODE_IDS };
