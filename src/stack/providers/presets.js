// Stack-side presets: shared core (metadata / defaults / pure hooks) plus the
// stack-local localized messages. The renderer's presets file assembles the
// same core with its own _t and svg icons — see presets-core.js for why the
// split exists.

import { PROVIDER_METADATA } from './metadata.js';
import { PRESET_CORE } from './presets-core.js';
import { _t } from '../i18n.js';

// Localized per-preset success messages (the only env-coupled hook part).
const TEST_MESSAGES = {
  'openai': (count) => _t('providerError.connectedModels', `连接成功，检测到 ${count} 个模型`, { count }),
  'deepseek': () => _t('providerError.connectSuccess', '连接成功'),
  'ollama': (count) => _t('providerError.connectedModels', `连接成功，检测到 ${count} 个模型`, { count }),
};

export const PRESETS = PRESET_CORE.map((core) => ({
  id: core.id,
  metadata: PROVIDER_METADATA[core.id],
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
