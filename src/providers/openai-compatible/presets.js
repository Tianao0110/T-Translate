// src/providers/openai-compatible/presets.js
// Renderer-side presets: shared core (metadata / defaults / pure hooks live in
// src/stack/providers/ — single source with the main-process stack) plus the
// renderer-local pieces: svg icons and localized test messages via renderer _t.
// To add a new OpenAI-compatible provider: extend presets-core.js + metadata.js,
// then register its icon/message here.

import openaiIcon from './icons/openai.svg';
import deepseekIcon from './icons/deepseek.svg';
import ollamaIcon from './icons/ollama.svg';
import localLlmIcon from './icons/local-llm.svg';
import { PROVIDER_METADATA } from '../../stack/providers/metadata.js';
import { PRESET_CORE } from '../../stack/providers/presets-core.js';
import { _t } from '../base.js';

const ICONS = {
  'openai': openaiIcon,
  'deepseek': deepseekIcon,
  'ollama': ollamaIcon,
  'local-llm': localLlmIcon,
};

// Localized per-preset success messages (the only env-coupled hook part —
// the stack has its own copy over the same i18n keys).
const TEST_MESSAGES = {
  'openai': (count) => _t('providerError.connectedModels', `连接成功，检测到 ${count} 个模型`, { count }),
  'deepseek': () => _t('providerError.connectSuccess', '连接成功'),
  'ollama': (count) => _t('providerError.connectedModels', `连接成功，检测到 ${count} 个模型`, { count }),
};

export const PRESETS = PRESET_CORE.map((core) => ({
  id: core.id,
  metadata: { ...PROVIDER_METADATA[core.id], icon: ICONS[core.id] },
  defaults: core.defaults,
  latencyLevel: core.latencyLevel,
  requiresNetwork: core.requiresNetwork,
  hooks: {
    ...core.hooks,
    ...(TEST_MESSAGES[core.id] ? { testConnectionMessage: TEST_MESSAGES[core.id] } : {}),
  },
}));

/**
 * Build a Provider subclass for a given preset.
 * The wrapper exists only so registry.js can keep its `class.metadata` contract
 * (BaseProvider.isConfigured() / getMissingConfig() read constructor.metadata.configSchema).
 */
export function createPresetProviderClass(preset, OpenAICompatibleProvider) {
  class PresetProvider extends OpenAICompatibleProvider {
    static metadata = { id: preset.id, ...preset.metadata };
    constructor(config = {}) {
      super({ ...preset.defaults, ...config }, preset);
    }
  }
  // Give the function a recognizable name for debug tooling
  Object.defineProperty(PresetProvider, 'name', {
    value: `${preset.id}-presetProvider`,
  });
  return PresetProvider;
}
