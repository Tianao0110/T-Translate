// One-time removal of settings keys no build reads any more. The renderer's
// settings migration drops these from its in-memory copy, but it only ever
// writes sub-buckets back, so the dead keys sat in config.json for years.
// Idempotent: a key is deleted only when present, so this costs nothing on
// a clean store.

// Pre-v0.3 flat mirrors of what now lives under settings.translation /
// settings.interface / settings.privacy, plus three retired buckets:
// providers -> translation.providers, connection -> ocr.llmEndpoint,
// glass -> floatingWindow (the settings.glassWindow rename is handled in
// state.js; this one was an even older shape).
const RETIRED_SETTINGS_KEYS = [
  'settings.providers',
  'settings.connection',
  'settings.glass',
  'settings.sourceLanguage',
  'settings.targetLanguage',
  'settings.autoTranslate',
  'settings.streamOutput',
  'settings.contextMemory',
  'settings.termCorrection',
  'settings.privacyMode',
  'settings.saveHistory',
  'settings.maxHistory',
  'settings.cacheEnabled',
  'settings.maxCache',
  'settings.theme',
  'settings.fontSize',
  'settings.debugMode',
];

function pruneRetiredSettings(store, keys = RETIRED_SETTINGS_KEYS) {
  let removed = 0;
  for (const key of keys) {
    if (store.has(key)) {
      store.delete(key);
      removed++;
    }
  }
  return removed;
}

module.exports = { RETIRED_SETTINGS_KEYS, pruneRetiredSettings };
