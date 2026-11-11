// The user's preferences in chrome.storage.local under 'prefs', merged over
// defaults on every read; the target language defaults to the browser's UI
// language. Pages that change prefs write the same key; onChange tells the
// orchestrator.

export const DISPLAYS = ['bilingual', 'translation', 'original'];
export const MODES = ['track', 'overlay'];
export const SIZES = ['small', 'medium', 'large', 'xlarge'];
export const PREFS_KEY = 'prefs';

export const DEFAULT_PREFS = Object.freeze({
  enabled: true,
  autoListen: false,
  display: 'bilingual',
  mode: 'overlay',
  size: 'medium',
  targetLang: null, // null: defaultTargetLang(ui language)
  sourceLang: 'auto',
  siteOff: {},
});

const LANG_RE = /^[A-Za-z0-9-]{1,16}$/;

// 'zh-CN' → 'zh', 'zh-TW' / 'zh-HK' → 'zh-TW', anything else its primary subtag.
export function defaultTargetLang(uiLang) {
  const tag = String(uiLang || 'en').replace('_', '-');
  const [primary, region] = tag.split('-');
  const p = primary.toLowerCase();
  if (p === 'zh') return /^(tw|hk|mo|hant)$/i.test(region || '') ? 'zh-TW' : 'zh';
  return p || 'en';
}

export function normalizePrefs(raw, uiLang) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const siteOff = {};
  if (r.siteOff && typeof r.siteOff === 'object') for (const [k, v] of Object.entries(r.siteOff)) if (v === true && typeof k === 'string' && k.length <= 128) siteOff[k] = true;
  return {
    enabled: r.enabled !== false,
    autoListen: r.autoListen === true,
    display: DISPLAYS.includes(r.display) ? r.display : DEFAULT_PREFS.display,
    mode: MODES.includes(r.mode) ? r.mode : DEFAULT_PREFS.mode,
    size: SIZES.includes(r.size) ? r.size : DEFAULT_PREFS.size,
    targetLang: typeof r.targetLang === 'string' && LANG_RE.test(r.targetLang) ? r.targetLang : defaultTargetLang(uiLang),
    sourceLang: typeof r.sourceLang === 'string' && LANG_RE.test(r.sourceLang) ? r.sourceLang : DEFAULT_PREFS.sourceLang,
    siteOff,
  };
}

export function createPrefs({ storage = globalThis.chrome?.storage, uiLang = () => globalThis.chrome?.i18n?.getUILanguage?.() } = {}) {
  let raw = null;
  let loaded = null;
  const listeners = new Set();

  const current = () => normalizePrefs(raw, uiLang());

  storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== 'local' || !changes[PREFS_KEY]) return;
    raw = changes[PREFS_KEY].newValue ?? null;
    const p = current();
    for (const fn of listeners) fn(p);
  });

  return {
    load() {
      loaded ??= Promise.resolve(storage?.local?.get(PREFS_KEY))
        .then((r) => {
          raw = r?.[PREFS_KEY] ?? null;
        })
        .catch(() => {});
      return loaded;
    },
    get: current,
    // Writes the merged prefs; onChange fires through storage.onChanged.
    async set(patch) {
      const next = { ...(raw && typeof raw === 'object' ? raw : {}), ...patch };
      raw = next;
      await storage?.local?.set({ [PREFS_KEY]: next });
      return current();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
