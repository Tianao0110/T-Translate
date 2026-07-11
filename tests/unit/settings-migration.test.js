// migrateOldSettings coverage for the glass -> floatingWindow bucket unification
// and the paddle-ocr engine id remap.

import { describe, it, expect } from 'vitest';
import { migrateOldSettings, DEFAULT_SETTINGS } from '../../src/components/SettingsPanel/constants.js';

describe('migrateOldSettings: floatingWindow unification', () => {
  it('fills floatingWindow defaults when nothing was saved', () => {
    const m = migrateOldSettings({});
    expect(m.floatingWindow).toEqual(DEFAULT_SETTINGS.floatingWindow);
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
      floatingWindow: { defaultOpacity: 0.6 },
    });
    expect(m.floatingWindow.defaultOpacity).toBe(0.6);
    expect(m.glass).toBeUndefined();
  });
});

describe('migrateOldSettings: sameLanguageBehavior (lockTargetLang retirement)', () => {
  it("fills the 'original' default when nothing was saved", () => {
    const m = migrateOldSettings({});
    expect(m.translation.sameLanguageBehavior).toBe('original');
  });

  it("legacy lockTargetLang=true maps to 'original' and the key is dropped", () => {
    const m = migrateOldSettings({ floatingWindow: { lockTargetLang: true } });
    expect(m.translation.sameLanguageBehavior).toBe('original');
    expect(m.floatingWindow.lockTargetLang).toBeUndefined();
    expect(m.floatingWindow.defaultOpacity).toBe(0.85);
  });

  it("legacy lockTargetLang=false is dropped without forcing a value", () => {
    const m = migrateOldSettings({ floatingWindow: { lockTargetLang: false } });
    expect(m.translation.sameLanguageBehavior).toBe('original');
    expect(m.floatingWindow.lockTargetLang).toBeUndefined();
  });

  it('an explicit saved behavior wins over the legacy key', () => {
    const m = migrateOldSettings({
      translation: { sameLanguageBehavior: 'swap' },
      floatingWindow: { lockTargetLang: true },
    });
    expect(m.translation.sameLanguageBehavior).toBe('swap');
    expect(m.floatingWindow.lockTargetLang).toBeUndefined();
  });
});

describe('migrateOldSettings: document bucket reshape (0.2.9)', () => {
  it('fills defaults when nothing was saved', () => {
    const m = migrateOldSettings({});
    expect(m.document).toEqual(DEFAULT_SETTINGS.document);
  });

  it('drops dead pre-0.2.9 keys', () => {
    const m = migrateOldSettings({
      document: { preserveFormatting: true, batchSize: 5, maxParagraphLength: 1000, outputFormat: 'same' },
    });
    expect(m.document.preserveFormatting).toBeUndefined();
    expect(m.document.batchSize).toBeUndefined();
    expect(m.document.maxParagraphLength).toBeUndefined();
    expect(m.document.maxCharsPerSegment).toBe(800);
  });

  it('maps batchMaxSegments onto concurrency with clamping', () => {
    expect(migrateOldSettings({ document: { batchMaxSegments: 4 } }).document.concurrency).toBe(4);
    expect(migrateOldSettings({ document: { batchMaxSegments: 10 } }).document.concurrency).toBe(6);
  });

  it('explicit concurrency wins over legacy batchMaxSegments', () => {
    const m = migrateOldSettings({ document: { concurrency: 3, batchMaxSegments: 5 } });
    expect(m.document.concurrency).toBe(3);
  });

  it('partial filters deep-merge with defaults', () => {
    const m = migrateOldSettings({ document: { filters: { skipShort: false } } });
    expect(m.document.filters.skipShort).toBe(false);
    expect(m.document.filters.skipNumbers).toBe(true);
    expect(m.document.filters.minLength).toBe(10);
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
