// @vitest-environment node
//
// Preferences: defaults and validation, the target language from the UI
// language, reading and writing chrome.storage.local, and change events.

import { describe, it, expect, vi } from 'vitest';
import { createPrefs, defaultTargetLang, normalizePrefs, DEFAULT_PREFS } from '../src/sw/prefs.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  const fns = [];
  return {
    data,
    local: {
      get: vi.fn(async (key) => ({ [key]: data[key] })),
      set: vi.fn(async (obj) => {
        Object.assign(data, obj);
        fns.forEach((fn) => fn(Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }])), 'local'));
      }),
    },
    onChanged: { addListener: (fn) => fns.push(fn) },
  };
}

describe('prefs', () => {
  it('target language follows the UI language', () => {
    expect(defaultTargetLang('zh-CN')).toBe('zh');
    expect(defaultTargetLang('zh')).toBe('zh');
    expect(defaultTargetLang('zh-TW')).toBe('zh-TW');
    expect(defaultTargetLang('zh-HK')).toBe('zh-TW');
    expect(defaultTargetLang('en-US')).toBe('en');
    expect(defaultTargetLang('ja')).toBe('ja');
    expect(defaultTargetLang(undefined)).toBe('en');
  });

  it('normalizes stored values over the defaults', () => {
    expect(normalizePrefs(null, 'zh-CN')).toEqual({ ...DEFAULT_PREFS, targetLang: 'zh' });
    expect(normalizePrefs({ enabled: false, autoListen: true, display: 'translation', mode: 'track', size: 'xlarge', targetLang: 'ja', sourceLang: 'en', siteOff: { youtube: true, bad: 'x' } }, 'en')).toEqual({ enabled: false, autoListen: true, display: 'translation', mode: 'track', size: 'xlarge', targetLang: 'ja', sourceLang: 'en', siteOff: { youtube: true } });
    expect(normalizePrefs({ display: 'huge', mode: 3, size: 'giant', targetLang: 'not a lang!', sourceLang: '' }, 'en')).toMatchObject({ display: 'bilingual', mode: 'overlay', size: 'medium', targetLang: 'en', sourceLang: 'auto' });
  });

  it('loads, reads, writes and reports changes', async () => {
    const storage = fakeStorage({ prefs: { autoListen: true } });
    const prefs = createPrefs({ storage, uiLang: () => 'zh-CN' });
    expect(prefs.get()).toMatchObject({ autoListen: false, targetLang: 'zh' });
    await prefs.load();
    expect(prefs.get()).toMatchObject({ autoListen: true, targetLang: 'zh' });
    const seen = [];
    prefs.onChange((p) => seen.push(p));
    const next = await prefs.set({ siteOff: { youtube: true } });
    expect(next).toMatchObject({ autoListen: true, siteOff: { youtube: true } });
    expect(storage.data.prefs).toEqual({ autoListen: true, siteOff: { youtube: true } });
    expect(seen).toHaveLength(1);
    expect(seen[0].siteOff).toEqual({ youtube: true });
  });
});
