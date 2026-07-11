// Phase A sourceLanguage precedence: translateText resolves
//   sourceLang = overrideSourceLang || translation.sourceLanguage || 'auto'
// Verifies all three trigger paths pass the right sourceLang through:
//   - handleTriggerClick (icon flow) — state, no override
//   - onShowDirect (CapsLock sticky) — newTranslation.sourceLanguage as override
//   - onShowResult (screenshot OCR) — data.sourceLanguage as override

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

let triggerCb = null;
let directCb = null;
let resultCb = null;

vi.mock('../../src/services/stack-client.js', () => ({
  default: {
    initialized: true,
    init: vi.fn(() => Promise.resolve()),
    translate: vi.fn(() => Promise.resolve({ success: true, text: 'TRANSLATED' })),
  },
}));

vi.mock('../../src/services/tts/index.js', () => ({
  default: {
    init: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    speak: vi.fn(),
    onStatusChange: vi.fn(),
  },
  TTS_STATUS: { IDLE: 'idle', SPEAKING: 'speaking', STOPPED: 'stopped' },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../src/utils/error-handler.js', () => ({
  getShortErrorMessage: (err) => (err?.message || String(err)),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key, fallback) => fallback || _key }),
}));

vi.mock('@config/defaults', () => ({
  PRIVACY_MODES: { STANDARD: 'standard' },
  THEMES: { LIGHT: 'light', DARK: 'dark' },
  LANGUAGE_CODES: ['auto', 'zh', 'en'],
  selectionDefaults: {},
  DEFAULT_SETTINGS: {
    triggerTimeout: 4000, showSourceByDefault: false,
    autoCloseOnCopy: false, minChars: 2, maxChars: 500, windowOpacity: 95,
  },
  DEFAULT_TRANSLATION: { sourceLanguage: 'auto', targetLanguage: 'zh' },
}));

beforeEach(() => {
  triggerCb = null;
  directCb = null;
  resultCb = null;
  vi.clearAllMocks();

  global.window = Object.assign(global.window || {}, {
    electron: {
      selection: {
        onShowTrigger: (cb) => { triggerCb = cb; return () => {}; },
        onShowResult: (cb) => { resultCb = cb; return () => {}; },
        onShowDirect: (cb) => { directCb = cb; return () => {}; },
        getText: vi.fn(() => Promise.resolve({ text: 'fetchedFromGetText' })),
        addToHistory: vi.fn(),
        notifyDestroyed: () => {},
        getWindowId: () => Promise.resolve(0),
        applyShowSource: () => {},
      },
    },
  });
});

afterEach(() => {
  cleanup();
});

const SelectionTranslator = (await import('../../src/components/SelectionTranslator/index.jsx')).default;

async function fireShowTrigger(data) {
  await act(async () => {
    triggerCb({
      mouseX: 100, mouseY: 100,
      theme: 'light',
      settings: { triggerTimeout: 4000, minChars: 2, maxChars: 500 },
      translation: { sourceLanguage: 'auto', targetLanguage: 'zh' },
      text: null,  // default Layer 1/2 path — no prefetched value
      ...data,
    });
    await new Promise(r => setTimeout(r, 120));
  });
}

async function fireShowDirect(data) {
  await act(async () => {
    await directCb({
      text: 'directText',
      theme: 'light',
      settings: { triggerTimeout: 4000, minChars: 2, maxChars: 500 },
      translation: { sourceLanguage: 'auto', targetLanguage: 'zh' },
      ...data,
    });
  });
}

describe('Phase A — translateText sourceLanguage precedence', () => {
  it('handleTriggerClick (icon flow) → translate receives state sourceLanguage', async () => {
    const { container } = render(<SelectionTranslator />);

    // SHOW_TRIGGER writes translation.sourceLanguage='en' into state.
    await fireShowTrigger({
      text: 'someEnglishText',  // pass-through path, avoids GET_TEXT
      translation: { sourceLanguage: 'en', targetLanguage: 'zh' },
    });

    const trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    const translationService = (await import('../../src/services/stack-client.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });

    // translate's second arg is the options object.
    const options = translationService.translate.mock.calls[0][1];
    expect(options.sourceLang).toBe('en');
  });

  it('onShowDirect (CapsLock sticky) → translate receives newTranslation.sourceLanguage as override', async () => {
    render(<SelectionTranslator />);

    await fireShowDirect({
      text: 'capsLockSticky',
      translation: { sourceLanguage: 'ja', targetLanguage: 'zh' },
    });

    const translationService = (await import('../../src/services/stack-client.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });

    const options = translationService.translate.mock.calls[0][1];
    expect(options.sourceLang).toBe('ja');
  });

  it('onShowDirect without sourceLanguage → falls back to \'auto\'', async () => {
    render(<SelectionTranslator />);

    await fireShowDirect({
      text: 'noSourceLang',
      translation: { targetLanguage: 'zh' },  // no sourceLanguage
    });

    const translationService = (await import('../../src/services/stack-client.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });

    const options = translationService.translate.mock.calls[0][1];
    expect(options.sourceLang).toBe('auto');
  });

  it('translation.sourceLanguage = \'auto\' → translate receives \'auto\' (default-case regression)', async () => {
    const { container } = render(<SelectionTranslator />);

    await fireShowTrigger({
      text: 'defaultAutoText',
      translation: { sourceLanguage: 'auto', targetLanguage: 'zh' },
    });

    const trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    const translationService = (await import('../../src/services/stack-client.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });

    const options = translationService.translate.mock.calls[0][1];
    expect(options.sourceLang).toBe('auto');
  });
});

// 2026-07-10 user report: with target=en, selecting English text translated it
// to Chinese (hardcoded zh<->en flip) instead of following the target language.
describe('sameLanguageBehavior — text already in the target language', () => {
  it("default ('original') shows the source untranslated, no provider call, no history", async () => {
    const { container } = render(<SelectionTranslator />);

    await fireShowTrigger({
      text: 'someEnglishText',
      translation: { sourceLanguage: 'auto', targetLanguage: 'en' },
    });

    const trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 150));
    });

    const translationService = (await import('../../src/services/stack-client.js')).default;
    expect(translationService.translate).not.toHaveBeenCalled();
    expect(window.electron.selection.addToHistory).not.toHaveBeenCalled();
    expect(container.textContent).toContain('someEnglishText');
  });

  it("'swap' keeps the legacy flip: en target + en text → translates to zh", async () => {
    const { container } = render(<SelectionTranslator />);

    await fireShowTrigger({
      text: 'someEnglishText',
      translation: { sourceLanguage: 'auto', targetLanguage: 'en', sameLanguageBehavior: 'swap' },
    });

    const trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    const translationService = (await import('../../src/services/stack-client.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });

    const options = translationService.translate.mock.calls[0][1];
    expect(options.targetLang).toBe('zh');
  });
});
