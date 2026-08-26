// Migration pack: build/parse round trip, the two product hard rules (no API
// keys anywhere, structure whitelisting of an untrusted file), and version
// gating.

import { describe, it, expect } from 'vitest';
import {
  buildMigrationPack,
  parseMigrationPack,
  stripSecrets,
  MIGRATION_FORMAT,
  MIGRATION_VERSION,
} from '../../src/utils/migration-pack.js';

const providersMeta = [
  { id: 'openai', configSchema: { apiKey: { encrypted: true }, model: {} } },
  { id: 'deepl', configSchema: { authKey: { encrypted: true } } },
];

const dirtySettings = {
  interface: { theme: 'dark', language: 'zh', systemNotifications: true },
  ocr: {
    engine: 'llm-vision',
    ocrspaceKey: 'LEAKED-OCR-KEY',
    baiduApiKey: 'LEAKED-BAIDU',
    baiduSecretKey: 'LEAKED-BAIDU-SECRET',
    azureEndpoint: 'https://example.azure.com',
  },
  translation: {
    targetLanguage: 'zh',
    providerConfigs: {
      openai: { apiKey: 'sk-LEAKED', model: 'gpt-4o-mini' },
      deepl: { authKey: 'LEAKED-DEEPL' },
      mystery: { api_key: 'LEAKED-MYSTERY', endpoint: 'https://x.example' },
    },
  },
  aiActions: { imported: [{ id: 'a1' }], digestThreshold: 150 },
};

const favorites = [
  { id: '1', sourceText: 'hello', translatedText: '你好', folderId: null, sourceLanguage: 'en', targetLanguage: 'zh', tags: ['a'] },
  { id: '2', sourceText: 'API', translatedText: '接口', folderId: 'glossary', note: 'tech', tags: [] },
  { id: '3', sourceText: '', translatedText: 'broken', folderId: null },
  { id: '4', sourceText: 'style', translatedText: '风格', folderId: 'style_library', isStyleReference: true },
];

describe('buildMigrationPack', () => {
  const pack = buildMigrationPack({
    settings: dirtySettings,
    favorites,
    customLanguages: [{ code: 'tlh', name: '克林贡语', promptName: 'Klingon' }, { code: '', name: 'bad' }],
    appVersion: '0.3.7',
    providersMeta,
  });

  it('carries format, version and app version', () => {
    expect(pack.format).toBe(MIGRATION_FORMAT);
    expect(pack.version).toBe(MIGRATION_VERSION);
    expect(pack.appVersion).toBe('0.3.7');
  });

  it('strips every secret but keeps non-secret fields', () => {
    const s = pack.payload.settings;
    expect(s.ocr.ocrspaceKey).toBeUndefined();
    expect(s.ocr.baiduApiKey).toBeUndefined();
    expect(s.ocr.baiduSecretKey).toBeUndefined();
    expect(s.ocr.azureEndpoint).toBe('https://example.azure.com');
    expect(s.translation.providerConfigs.openai.apiKey).toBeUndefined();
    expect(s.translation.providerConfigs.openai.model).toBe('gpt-4o-mini');
    expect(s.translation.providerConfigs.deepl.authKey).toBeUndefined();
    // No schema for 'mystery' — the name-pattern sweep must still catch it.
    expect(s.translation.providerConfigs.mystery.api_key).toBeUndefined();
    expect(s.translation.providerConfigs.mystery.endpoint).toBe('https://x.example');
    expect(JSON.stringify(pack)).not.toMatch(/LEAKED/);
  });

  it('does not mutate the input settings', () => {
    expect(dirtySettings.ocr.ocrspaceKey).toBe('LEAKED-OCR-KEY');
  });

  it('splits glossary terms from plain favorites and drops broken rows', () => {
    expect(pack.payload.glossary).toHaveLength(1);
    expect(pack.payload.glossary[0]).toMatchObject({ source: 'API', target: '接口', note: 'tech' });
    expect(pack.payload.favorites).toHaveLength(2);
    expect(pack.payload.favorites.find((f) => f.folderId === 'style_library').isStyleReference).toBe(true);
  });

  it('whitelists custom languages', () => {
    expect(pack.payload.customLanguages).toEqual([{ code: 'tlh', name: '克林贡语', promptName: 'Klingon' }]);
  });
});

describe('parseMigrationPack', () => {
  const roundTrip = () => {
    const pack = buildMigrationPack({
      settings: dirtySettings, favorites, customLanguages: [{ code: 'tlh', name: 'K' }],
      appVersion: '0.3.7', providersMeta,
    });
    return parseMigrationPack(JSON.stringify(pack));
  };

  it('round-trips its own output with a correct summary', () => {
    const r = roundTrip();
    expect(r.ok).toBe(true);
    expect(r.summary).toMatchObject({ glossary: 1, favorites: 2, customLanguages: 1, importedActions: 1 });
    expect(r.summary.settingsBuckets).toBeGreaterThanOrEqual(4);
  });

  it('rejects non-pack JSON and garbage', () => {
    expect(parseMigrationPack('not json').error).toBe('parse');
    expect(parseMigrationPack('{"format":"something else","version":1}').error).toBe('format');
    expect(parseMigrationPack('{"format":"T-Translate Migration"}').error).toBe('format');
  });

  it('refuses packs from a newer format version', () => {
    const r = parseMigrationPack(JSON.stringify({ format: MIGRATION_FORMAT, version: MIGRATION_VERSION + 1, payload: {} }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('newer-version');
  });

  it('drops unknown settings buckets and non-object bucket values', () => {
    const r = parseMigrationPack(JSON.stringify({
      format: MIGRATION_FORMAT,
      version: 1,
      payload: { settings: { interface: { theme: 'dark' }, evilBucket: { x: 1 }, ocr: 'not-an-object' } },
    }));
    expect(r.ok).toBe(true);
    expect(r.payload.settings).toEqual({ interface: { theme: 'dark' } });
  });

  it('accepts glossary rows in either term shape and drops empty ones', () => {
    const r = parseMigrationPack(JSON.stringify({
      format: MIGRATION_FORMAT,
      version: 1,
      payload: { glossary: [
        { source: 'a', target: 'b' },
        { sourceText: 'c', translatedText: 'd' },
        { source: '', target: 'x' },
        null,
      ] },
    }));
    expect(r.payload.glossary).toHaveLength(2);
  });

  it('tolerates a missing payload', () => {
    const r = parseMigrationPack(JSON.stringify({ format: MIGRATION_FORMAT, version: 1 }));
    expect(r.ok).toBe(true);
    expect(r.summary).toEqual({ settingsBuckets: 0, glossary: 0, favorites: 0, customLanguages: 0, importedActions: 0 });
  });
});

describe('stripSecrets standalone', () => {
  it('handles missing buckets without throwing', () => {
    expect(stripSecrets(null)).toEqual({});
    expect(stripSecrets({ interface: { theme: 'light' } })).toEqual({ interface: { theme: 'light' } });
  });
});
