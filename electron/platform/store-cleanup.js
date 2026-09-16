// One-time, idempotent removal of settings keys no build reads any more
// (state.js runs it at startup).

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
