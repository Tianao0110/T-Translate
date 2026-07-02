// Privacy-mode definitions. Each mode pins feature flags and an
// optional allowlist of providers / OCR engines. Consumed app-wide.

import { PRIVACY_MODES as PRIVACY_MODE_IDS, PROVIDER_IDS, OCR_ENGINES } from './constants.js';

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
      floatingWindow: true,
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
      floatingWindow: true,
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
      floatingWindow: true,
      documentTranslate: true,
      exportData: true,
      ocr: true,
    },
    allowedProviders: [PROVIDER_IDS.LOCAL_LLM, PROVIDER_IDS.OLLAMA],
    allowedOcrEngines: [OCR_ENGINES.LLM_VISION, OCR_ENGINES.WINDOWS_OCR, OCR_ENGINES.RAPID_OCR],
  },
};

export function getPrivacyModeConfig(mode) {
  return PRIVACY_MODES[mode] || PRIVACY_MODES[PRIVACY_MODE_IDS.STANDARD];
}

export function isProviderAllowed(providerId, mode) {
  const config = PRIVACY_MODES[mode];
  if (!config) return true;
  if (config.allowedProviders === null) return true;
  return config.allowedProviders.includes(providerId);
}

export function isOcrEngineAllowed(engineId, mode) {
  const config = PRIVACY_MODES[mode];
  if (!config) return true;
  if (config.allowedOcrEngines === null) return true;
  return config.allowedOcrEngines.includes(engineId);
}

export function getModeFeatures(mode) {
  return PRIVACY_MODES[mode]?.features || PRIVACY_MODES[PRIVACY_MODE_IDS.STANDARD].features;
}

export function isFeatureEnabled(mode, featureName) {
  const features = getModeFeatures(mode);
  return features[featureName] !== false;
}

export { PRIVACY_MODE_IDS };
