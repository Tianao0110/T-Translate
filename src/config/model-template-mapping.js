// Detects translation-only "MT specialist" models from their name; the
// stack (stack/service.js buildMTPrompt) switches to the user-only prompt
// for them. New rules match the family, not the version.

const MODEL_TEMPLATE_RULES = [
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
