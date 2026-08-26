// Migration pack: build and parse the single-file JSON that moves settings,
// glossary, favorites and custom languages between machines.
//
// Two hard rules from the product side:
//   - No API keys. The persisted settings are already key-free (secrets live
//     in the DPAPI vault, which is machine-bound), but both build and the
//     import path strip secret fields again — a hand-edited config.json or an
//     old install must not leak keys into a shareable file.
//   - No model binaries. This module only ever touches JSON-able state.
//
// Pure functions; the callers own IPC, dialogs and store writes.

import { OCR_SECRET_FIELDS } from './ocr-key-vault.js';
import { DEFAULT_SETTINGS } from '../components/SettingsPanel/constants.js';

export const MIGRATION_FORMAT = 'T-Translate Migration';
export const MIGRATION_VERSION = 1;
export const MAX_PACK_BYTES = 20 * 1024 * 1024;

const SETTINGS_BUCKETS = Object.keys(DEFAULT_SETTINGS);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const cleanTags = (tags) =>
  Array.isArray(tags) ? tags.filter((t) => typeof t === 'string' && t).slice(0, 20) : [];

// Defense-in-depth secret removal. providersMeta carries each provider's
// configSchema so schema-declared encrypted fields go first; a name-pattern
// sweep catches providers the running build has no schema for.
export function stripSecrets(settings, providersMeta = []) {
  const clean = JSON.parse(JSON.stringify(settings || {}));

  if (isPlainObject(clean.ocr)) {
    for (const field of OCR_SECRET_FIELDS) delete clean.ocr[field];
  }

  const configs = clean.translation?.providerConfigs;
  if (isPlainObject(configs)) {
    for (const meta of providersMeta) {
      const cfg = configs[meta.id];
      if (!isPlainObject(cfg) || !meta.configSchema) continue;
      for (const [key, field] of Object.entries(meta.configSchema)) {
        if (field?.encrypted) delete cfg[key];
      }
    }
    for (const cfg of Object.values(configs)) {
      if (!isPlainObject(cfg)) continue;
      for (const key of Object.keys(cfg)) {
        if (/apikey|api_key|secret|token|password/i.test(key)) delete cfg[key];
      }
    }
  }

  return clean;
}

export function buildMigrationPack({ settings, favorites, customLanguages, appVersion, providersMeta }) {
  const glossary = [];
  const favs = [];

  for (const f of favorites || []) {
    if (!f || typeof f.sourceText !== 'string' || typeof f.translatedText !== 'string') continue;
    if (!f.sourceText || !f.translatedText) continue;
    if (f.folderId === 'glossary') {
      // Same term shape as the standalone glossary export (glossary-io.js),
      // so the two files stay mutually readable.
      glossary.push({
        source: f.sourceText,
        target: f.translatedText,
        note: typeof f.note === 'string' ? f.note : '',
        tags: cleanTags(f.tags),
        createdAt: f.createdAt || '',
      });
    } else {
      favs.push({
        sourceText: f.sourceText,
        translatedText: f.translatedText,
        sourceLanguage: typeof f.sourceLanguage === 'string' ? f.sourceLanguage : 'auto',
        targetLanguage: typeof f.targetLanguage === 'string' ? f.targetLanguage : 'zh',
        note: typeof f.note === 'string' ? f.note : '',
        tags: cleanTags(f.tags),
        folderId: typeof f.folderId === 'string' ? f.folderId : null,
        isStyleReference: f.isStyleReference === true,
        createdAt: f.createdAt || f.timestamp || '',
      });
    }
  }

  const languages = (customLanguages || [])
    .filter((l) => l && typeof l.code === 'string' && l.code && typeof l.name === 'string' && l.name)
    .map((l) => ({
      code: l.code.slice(0, 32),
      name: l.name.slice(0, 100),
      ...(typeof l.promptName === 'string' && l.promptName ? { promptName: l.promptName.slice(0, 100) } : {}),
    }));

  return {
    format: MIGRATION_FORMAT,
    version: MIGRATION_VERSION,
    appVersion: appVersion || '',
    exportedAt: new Date().toISOString(),
    payload: {
      settings: stripSecrets(settings, providersMeta),
      glossary,
      favorites: favs,
      customLanguages: languages,
    },
  };
}

function sanitizeSettingsBuckets(raw) {
  if (!isPlainObject(raw)) return null;
  const out = {};
  for (const bucket of SETTINGS_BUCKETS) {
    if (isPlainObject(raw[bucket])) out[bucket] = raw[bucket];
  }
  return Object.keys(out).length ? out : null;
}

function sanitizeTerms(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (!t) continue;
    const source = typeof t.source === 'string' ? t.source : (typeof t.sourceText === 'string' ? t.sourceText : '');
    const target = typeof t.target === 'string' ? t.target : (typeof t.translatedText === 'string' ? t.translatedText : '');
    if (!source || !target) continue;
    out.push({
      source,
      target,
      note: typeof t.note === 'string' ? t.note : '',
      tags: cleanTags(t.tags),
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : '',
    });
  }
  return out;
}

function sanitizeFavorites(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const f of raw) {
    if (!f || typeof f.sourceText !== 'string' || typeof f.translatedText !== 'string') continue;
    if (!f.sourceText || !f.translatedText) continue;
    out.push({
      sourceText: f.sourceText,
      translatedText: f.translatedText,
      sourceLanguage: typeof f.sourceLanguage === 'string' ? f.sourceLanguage : 'auto',
      targetLanguage: typeof f.targetLanguage === 'string' ? f.targetLanguage : 'zh',
      note: typeof f.note === 'string' ? f.note : '',
      tags: cleanTags(f.tags),
      folderId: typeof f.folderId === 'string' && f.folderId ? f.folderId : null,
      isStyleReference: f.isStyleReference === true,
      createdAt: typeof f.createdAt === 'string' || typeof f.createdAt === 'number' ? f.createdAt : '',
    });
  }
  return out;
}

function sanitizeCustomLanguages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l) => l && typeof l.code === 'string' && l.code && typeof l.name === 'string' && l.name)
    .map((l) => ({
      code: l.code.slice(0, 32),
      name: l.name.slice(0, 100),
      ...(typeof l.promptName === 'string' && l.promptName ? { promptName: l.promptName.slice(0, 100) } : {}),
    }));
}

// Parse and whitelist an untrusted pack file. Secret-stripping of the settings
// block and re-validation of imported AI actions happen at apply time (the
// caller has providersMeta and the action gate) — this layer owns structure.
export function parseMigrationPack(jsonString) {
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch {
    return { ok: false, error: 'parse' };
  }

  if (!isPlainObject(data) || data.format !== MIGRATION_FORMAT) return { ok: false, error: 'format' };
  if (typeof data.version !== 'number' || data.version < 1) return { ok: false, error: 'format' };
  if (data.version > MIGRATION_VERSION) return { ok: false, error: 'newer-version' };

  const p = isPlainObject(data.payload) ? data.payload : {};
  const settings = sanitizeSettingsBuckets(p.settings);
  const glossary = sanitizeTerms(p.glossary);
  const favorites = sanitizeFavorites(p.favorites);
  const customLanguages = sanitizeCustomLanguages(p.customLanguages);
  const importedActions = Array.isArray(settings?.aiActions?.imported)
    ? settings.aiActions.imported.length
    : 0;

  return {
    ok: true,
    meta: {
      appVersion: typeof data.appVersion === 'string' ? data.appVersion : '',
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    },
    summary: {
      settingsBuckets: settings ? Object.keys(settings).length : 0,
      glossary: glossary.length,
      favorites: favorites.length,
      customLanguages: customLanguages.length,
      importedActions,
    },
    payload: { settings, glossary, favorites, customLanguages },
  };
}
