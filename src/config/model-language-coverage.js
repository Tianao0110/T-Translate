// What languages a locally loaded model is documented to handle. Used only
// to reorder the failover chain, never for any claim in the UI
// (docs/design/renderer.md §8).
//
// Coverage values:
//   [...]   the documented set; a target outside it demotes this provider
//   'many'  broad multilingual (NLLB, MADLAD) — never demoted
//   absent  unknown — never demoted
//
// Incomplete on purpose: add a family only when its published coverage is
// clear and stable.

const MODEL_LANGUAGE_RULES = [
  {
    label: 'Meta Llama 3.x',
    // Meta documents exactly eight for 3.1 / 3.2 / 3.3.
    pattern: /\bllama[\s\-_]?3/i,
    languages: ['en', 'de', 'fr', 'it', 'pt', 'hi', 'es', 'th'],
  },
  {
    label: 'Qwen 2.x / 3.x',
    // Alibaba documents 29+; this is the published list.
    pattern: /\bqwen[\s\-_]?[23]/i,
    languages: [
      'zh', 'zh-TW', 'en', 'fr', 'es', 'pt', 'de', 'it', 'ru', 'ja', 'ko',
      'vi', 'th', 'ar', 'id', 'ms', 'tr', 'hi', 'he', 'fa', 'pl', 'nl',
      'cs', 'sv', 'da', 'no', 'fi', 'bn', 'ur',
    ],
  },
  {
    label: 'Meta NLLB-200',
    // 200 languages — the long tail is what it is for.
    pattern: /\bnllb/i,
    languages: 'many',
  },
  {
    label: 'Google MADLAD-400',
    pattern: /\bmadlad/i,
    languages: 'many',
  },
  {
    label: 'Helsinki Opus-MT',
    // The pair is the model: opus-mt-en-zh does en->zh and nothing else.
    pattern: /\bopus[\s\-_]?mt/i,
    derive: (modelName) => {
      const pair = modelName.match(/opus[\s\-_]?mt[\s\-_]([a-z]{2,3})[\s\-_]([a-z]{2,3})\b/i);
      return pair ? [pair[2].toLowerCase()] : null;
    },
  },
];

/**
 * Does this model's family cover the target language?
 *
 * @returns {boolean|null} null when nothing is known — the caller must treat
 *   that as "leave the order alone", not as "no".
 */
export function modelCoversLanguage(modelName, langCode) {
  if (!modelName || typeof modelName !== 'string' || !langCode) return null;

  for (const rule of MODEL_LANGUAGE_RULES) {
    if (!rule.pattern.test(modelName)) continue;

    const languages = rule.derive ? rule.derive(modelName) : rule.languages;
    if (!languages) return null;
    if (languages === 'many') return true;
    return languages.includes(langCode);
  }
  return null;
}

/**
 * Stable reorder: providers whose loaded model is known NOT to cover the
 * target move to the back, keeping their relative order. Never drops anyone —
 * a demoted provider still runs if everything ahead of it fails.
 *
 * @param {string[]} providerIds  in current priority order
 * @param {string} targetLang
 * @param {(id: string) => string} getModelName
 */
export function reorderForLanguage(providerIds, targetLang, getModelName) {
  const covers = [];
  const doesNot = [];

  for (const id of providerIds) {
    const verdict = modelCoversLanguage(getModelName(id), targetLang);
    (verdict === false ? doesNot : covers).push(id);
  }

  return doesNot.length ? [...covers, ...doesNot] : providerIds;
}
