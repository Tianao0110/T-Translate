// Pure-function coverage for the OCR pack registry: version compare,
// language -> pack mapping, and the installed-vs-manifest status merge that
// drives the settings UI badges.

import { describe, it, expect } from 'vitest';

const {
  BASE_PACK_ID,
  packIdForLanguage,
  compareVersions,
  computePackList,
} = await import('../../electron/shared/ocr-packs.js');

describe('packIdForLanguage', () => {
  it('maps built-in languages to the base pack', () => {
    for (const lang of ['auto', 'zh-Hans', 'zh-Hant', 'en', 'ja']) {
      expect(packIdForLanguage(lang)).toBe(BASE_PACK_ID);
    }
  });

  it('maps pack languages to their pack', () => {
    expect(packIdForLanguage('ko')).toBe('korean');
    expect(packIdForLanguage('fr')).toBe('latin');
    expect(packIdForLanguage('de')).toBe('latin');
    expect(packIdForLanguage('es')).toBe('latin');
    expect(packIdForLanguage('ru')).toBe('cyrillic');
    expect(packIdForLanguage('hi')).toBe('devanagari');
    expect(packIdForLanguage('ar')).toBe('arabic');
  });

  it('falls back to base for unknown languages', () => {
    expect(packIdForLanguage('xx')).toBe(BASE_PACK_ID);
    expect(packIdForLanguage(undefined)).toBe(BASE_PACK_ID);
  });
});

describe('compareVersions', () => {
  it('compares numerically per segment', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('2.0', '1.9.9')).toBe(1);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1', '1.0.1')).toBe(-1);
  });

  it('tolerates garbage input', () => {
    expect(compareVersions(undefined, '1.0.0')).toBe(-1);
    expect(compareVersions('abc', '0')).toBe(0);
  });
});

describe('computePackList', () => {
  const manifest = {
    packs: [
      { id: 'base-v5', type: 'base', version: '1.0.0' },
      { id: 'korean', type: 'lang', version: '1.0.0' },
      { id: 'cyrillic', type: 'lang', version: '2.0.0' },
    ],
  };

  it('marks manifest packs not on disk as not-installed', () => {
    const list = computePackList([], manifest);
    expect(list.find((p) => p.id === 'korean').status).toBe('not-installed');
  });

  it('marks same-version installed packs as installed', () => {
    const list = computePackList([{ id: 'korean', version: '1.0.0' }], manifest);
    const korean = list.find((p) => p.id === 'korean');
    expect(korean.status).toBe('installed');
    expect(korean.installedVersion).toBe('1.0.0');
  });

  it('marks older installed packs as update-available', () => {
    const list = computePackList([{ id: 'cyrillic', version: '1.0.0' }], manifest);
    expect(list.find((p) => p.id === 'cyrillic').status).toBe('update-available');
  });

  it('keeps newer-than-manifest local packs as installed (no downgrade offer)', () => {
    const list = computePackList([{ id: 'cyrillic', version: '3.0.0' }], manifest);
    expect(list.find((p) => p.id === 'cyrillic').status).toBe('installed');
  });

  it('keeps installed packs visible when the manifest is unreachable', () => {
    const list = computePackList([{ id: 'korean', version: '1.0.0' }], null);
    const korean = list.find((p) => p.id === 'korean');
    expect(korean.status).toBe('orphaned');
    expect(korean.installedVersion).toBe('1.0.0');
  });

  it('never surfaces the bundled base as orphaned', () => {
    const list = computePackList(
      [{ id: BASE_PACK_ID, version: '1.0.0', builtin: true }],
      null
    );
    expect(list.find((p) => p.id === BASE_PACK_ID)).toBeUndefined();
  });

  it('manifest fields win over stale local metadata in the merged entry', () => {
    const list = computePackList(
      [{ id: 'cyrillic', version: '1.0.0', size: 1 }],
      manifest
    );
    const cyr = list.find((p) => p.id === 'cyrillic');
    expect(cyr.version).toBe('2.0.0');
    expect(cyr.installedVersion).toBe('1.0.0');
  });
});
