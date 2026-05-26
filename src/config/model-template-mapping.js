// src/config/model-template-mapping.js
//
// Maps model names → template IDs. Used by services/translation.js when the
// user picks the "Auto" template — the service inspects the active provider's
// model name and falls back to 'natural' if no rule matches.
//
// MAINTENANCE: to support a new translation-specialized model, append a rule
// below. Patterns should be forward-compatible — match the family, not the
// version (e.g. `/\bhy[\s\-_]?mt/i` catches Hy-MT2, Hy-MT3, HyMT4, etc.).
// Avoid version-specific patterns like `/hy-mt2/i` that go stale on the next
// release.

export const MODEL_TEMPLATE_RULES = [
  {
    template: 'mt-direct',
    label: 'Tencent Hunyuan MT family',
    // Catches: hy-mt2-7b, hy-mt3, hunyuan-mt-1.8b, HyMT4, hunyuanmt, etc.
    pattern: /\b(hy|hunyuan)[\s\-_]?mt/i,
    examples: ['hy-mt2-7b', 'hunyuan-mt-1.8b', 'Hy-MT2', 'HunyuanMT3'],
  },
  // Add new rules here. Examples for future reference:
  // {
  //   template: 'mt-direct',
  //   label: 'Meta NLLB',
  //   pattern: /\bnllb/i,
  //   examples: ['nllb-200', 'nllb-1.3B'],
  // },
  // {
  //   template: 'mt-direct',
  //   label: 'Helsinki Opus-MT',
  //   pattern: /\bopus[\s\-_]?mt/i,
  //   examples: ['opus-mt-en-zh'],
  // },
];

/**
 * Look up a template id for the given model name.
 * @param {string|null|undefined} modelName
 * @returns {string|null} template id, or null if no rule matches
 */
export function detectTemplateFromModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return null;
  for (const rule of MODEL_TEMPLATE_RULES) {
    if (rule.pattern.test(modelName)) return rule.template;
  }
  return null;
}
