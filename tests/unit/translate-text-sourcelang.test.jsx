// Phase A sourceLanguage 优先级单测 — v0.2.5
// 验：translateText 内部 sourceLang = overrideSourceLang || translation.sourceLanguage || 'auto'
//     三种触发路径的 sourceLang 透传是否正确：
//       - handleTriggerClick（图标流）→ 走 state，不传 override
//       - onShowDirect（CapsLock 直出）→ 传 newTranslation.sourceLanguage 作 override
//       - onShowResult（截图 OCR）→ 传 data.sourceLanguage 作 override

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

let triggerCb = null;
let directCb = null;
let resultCb = null;

vi.mock('../../src/services/translation.js', () => ({
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
      rect: { x: 100, y: 100, width: 50, height: 20 },
      theme: 'light',
      settings: { triggerTimeout: 4000, minChars: 2, maxChars: 500 },
      translation: { sourceLanguage: 'auto', targetLanguage: 'zh' },
      text: null,  // 默认 Layer 1/2 路径，无 prefetched
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

describe('Phase A — translateText sourceLanguage 优先级', () => {
  it('handleTriggerClick（图标流）→ translate 收到 state 的 sourceLanguage', async () => {
    const { container } = render(<SelectionTranslator />);

    // SHOW_TRIGGER 把 translation.sourceLanguage='en' 写到 state
    await fireShowTrigger({
      text: 'someEnglishText',  // pass-through 路径，避免 GET_TEXT
      translation: { sourceLanguage: 'en', targetLanguage: 'zh' },
    });

    const trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    const translationService = (await import('../../src/services/translation.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });

    // translate 第二个参数是 options 对象
    const options = translationService.translate.mock.calls[0][1];
    expect(options.sourceLang).toBe('en');
  });

  it('onShowDirect（CapsLock 直出）→ translate 收到 newTranslation.sourceLanguage 作 override', async () => {
    render(<SelectionTranslator />);

    await fireShowDirect({
      text: 'capsLockSticky',
      translation: { sourceLanguage: 'ja', targetLanguage: 'zh' },
    });

    const translationService = (await import('../../src/services/translation.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });

    const options = translationService.translate.mock.calls[0][1];
    expect(options.sourceLang).toBe('ja');
  });

  it('onShowDirect 无 sourceLanguage → fallback 到 \'auto\'', async () => {
    render(<SelectionTranslator />);

    await fireShowDirect({
      text: 'noSourceLang',
      translation: { targetLanguage: 'zh' },  // 不带 sourceLanguage
    });

    const translationService = (await import('../../src/services/translation.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });

    const options = translationService.translate.mock.calls[0][1];
    expect(options.sourceLang).toBe('auto');
  });

  it('translation.sourceLanguage 为 \'auto\' 时 → translate 收到 \'auto\'（默认场景回归）', async () => {
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

    const translationService = (await import('../../src/services/translation.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });

    const options = translationService.translate.mock.calls[0][1];
    expect(options.sourceLang).toBe('auto');
  });
});
