// What languages a locally loaded model is documented to handle.
//
// WHY THIS EXISTS: the failover chain only advances on failure, and an LLM
// asked for a language it does not know does not fail — it produces fluent
// nonsense and reports success. So a user with LM Studio first in the chain
// and Google behind it never reaches Google for Tibetan: the local model
// "succeeds" and the chain stops. This table lets the chain skip ahead before
// that happens.
//
// SCOPE — read this before adding anything:
//
//   Used ONLY to reorder the failover chain. Never to grey out, filter, warn
//   or otherwise make a claim in the UI. Model names are unreliable
//   identifiers (fine-tunes, quantized re-uploads, renamed local files), and
//   published language lists are conservative, so every entry here is a guess
//   with a good prior — fine for "try Google first", dishonest as a statement
//   to the user.
//
//   That constraint is what makes the failure modes safe:
//     no rule matches      -> no reorder     -> exactly today's behavior
//     rule matches wrongly -> Google goes first -> Google translates it anyway
//     rule matches rightly -> long tail skips the small model    -> better
//
//   Nothing here can make the app worse than not having it. Keep it that way.
//
// COVERAGE VALUES:
//   [...]   the documented set; a target outside it demotes this provider
//   'many'  broad multilingual (NLLB, MADLAD) — never demoted
//   absent  unknown — never demoted
//
// MAINTENANCE: incomplete on purpose. Add a family only when its published
// coverage is clear and stable; a missing entry costs nothing.

export const MODEL_LANGUAGE_RULES = [
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
    // Sending it anything else returns confident garbage, which makes this the
    // single most valuable rule in the table.
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
