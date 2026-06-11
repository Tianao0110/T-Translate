// migrateOldSettings coverage for the glass -> floatingWindow bucket unification
// and the paddle-ocr engine id remap.

import { describe, it, expect } from 'vitest';
import { migrateOldSettings, DEFAULT_SETTINGS } from '../../src/components/SettingsPanel/constants.js';

describe('migrateOldSettings: floatingWindow unification', () => {
  it('fills floatingWindow defaults when nothing was saved', () => {
    const m = migrateOldSettings({});
    expect(m.floatingWindow).toEqual(DEFAULT_SETTINGS.floatingWindow);
    expect(m.floatingWindow.lockTargetLang).toBe(false);
    expect(m.floatingWindow.defaultOpacity).toBe(0.85);
  });

  it('maps legacy glass.opacity to floatingWindow.defaultOpacity and drops the old bucket', () => {
    const m = migrateOldSettings({ glass: { opacity: 0.7, width: 400, fontSize: 14 } });
    expect(m.floatingWindow.defaultOpacity).toBe(0.7);
    expect(m.glass).toBeUndefined();
  });

  it('existing floatingWindow values win over legacy glass values', () => {
    const m = migrateOldSettings({
      glass: { opacity: 0.7 },
      floatingWindow: { defaultOpacity: 0.6, lockTargetLang: true },
    });
    expect(m.floatingWindow.defaultOpacity).toBe(0.6);
    expect(m.floatingWindow.lockTargetLang).toBe(true);
    expect(m.glass).toBeUndefined();
  });

  it('partial floatingWindow gets all newly-added defaults', () => {
    const m = migrateOldSettings({ floatingWindow: { lockTargetLang: true } });
    expect(m.floatingWindow.lockTargetLang).toBe(true);
    expect(m.floatingWindow.defaultOpacity).toBe(0.85);
  });
});

describe('migrateOldSettings: removed OCR engine id', () => {
  it('remaps paddle-ocr to rapid-ocr', () => {
    const m = migrateOldSettings({ ocr: { engine: 'paddle-ocr' } });
    expect(m.ocr.engine).toBe('rapid-ocr');
  });

  it('leaves other engine ids alone', () => {
    for (const id of ['rapid-ocr', 'windows-ocr', 'llm-vision', 'baidu-ocr']) {
      expect(migrateOldSettings({ ocr: { engine: id } }).ocr.engine).toBe(id);
    }
  });
});
