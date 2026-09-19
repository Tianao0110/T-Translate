// Model names a vendor has switched off, mapped to the name that serves the
// same role now. registry.js runs every config it takes in through
// withLiveModel, so a saved setting keeps working after a switch-off.
// Dates and sources: docs/design/stack.md.

export const RETIRED_MODELS = {
  deepseek: {
    'deepseek-chat': 'deepseek-flash',
    'deepseek-reasoner': 'deepseek-flash',
  },
  gemini: {
    'gemini-2.0-flash': 'gemini-flash-latest',
    'gemini-2.0-flash-001': 'gemini-flash-latest',
  },
};

export function withLiveModel(id, config) {
  const live = RETIRED_MODELS[id]?.[config?.model];
  return live ? { ...config, model: live } : config;
}
