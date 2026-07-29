// Phase B text pass-through: SHOW_TRIGGER carries `text`, renderer stashes
// it in a ref, the trigger click prefers the ref and falls back to GET_TEXT,
// the prefetched value is cleared after one use, and a later SHOW_TRIGGER
// overwrites any pending value.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

let triggerCb = null;

// vi.mock must run before all imports — vitest hoists these.
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
  useTranslation: () => ({ t: (_key, fallback) => fallback || _key, i18n: { language: 'zh' } }),
  // src/i18n.js now runs for real in this graph (ai-action-runner imports it)
  // and hands this to i18next.use(); a stub keeps that bootstrap from throwing.
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@config/defaults', () => ({
  PRIVACY_MODES: { STANDARD: 'standard' },
  THEMES: { LIGHT: 'light', DARK: 'dark' },
  LANGUAGE_CODES: ['auto', 'zh', 'en'],
  selectionDefaults: {},
  DEFAULT_SETTINGS: {
    triggerTimeout: 4000,
    showSourceByDefault: false,
    autoCloseOnCopy: false,
    minChars: 2,
    maxChars: 500,
    windowOpacity: 95,
  },
  DEFAULT_TRANSLATION: { sourceLanguage: 'auto', targetLanguage: 'zh' },
}));

const mockGetText = vi.fn();
const mockAddToHistory = vi.fn();

beforeEach(() => {
  triggerCb = null;
  vi.clearAllMocks();

  // Mock window.electron — capture the listener callback so the test can fire it.
  global.window = Object.assign(global.window || {}, {
    electron: {
      selection: {
        onShowTrigger: (cb) => { triggerCb = cb; return () => { triggerCb = null; }; },
        onShowResult: () => () => {},
        onShowDirect: () => () => {},
        getText: mockGetText,
        addToHistory: mockAddToHistory,
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

// Helper: fire onShowTrigger callback and wait for React state to flush.
async function fireShowTrigger(data) {
  await act(async () => {
    triggerCb({
      mouseX: 100, mouseY: 100,
      theme: 'light',
      settings: { triggerTimeout: 4000, minChars: 2, maxChars: 500 },
      translation: { sourceLanguage: 'auto', targetLanguage: 'zh' },
      ...data,
    });
    // Flush the 100ms triggerReady timer so the icon can accept clicks.
    await new Promise(r => setTimeout(r, 120));
  });
}

describe('Phase B — text pass-through via SHOW_TRIGGER', () => {
  it('SHOW_TRIGGER with text → trigger click uses prefetched, no GET_TEXT', async () => {
    const { container } = render(<SelectionTranslator />);
    expect(triggerCb).toBeTruthy();

    await fireShowTrigger({ text: 'hello world' });

    const trigger = container.querySelector('.sel-trigger');
    expect(trigger).toBeTruthy();

    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    // Key assertion: translate called with 'hello world', getText not called.
    const translationService = (await import('../../src/services/stack-client.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });
    expect(translationService.translate.mock.calls[0][0]).toBe('hello world');
    expect(mockGetText).not.toHaveBeenCalled();
  });

  it('SHOW_TRIGGER without text (Layer 1/2) → trigger click falls back to GET_TEXT', async () => {
    const { container } = render(<SelectionTranslator />);
    mockGetText.mockResolvedValue({ text: 'fallback text' });

    await fireShowTrigger({ text: null });  // explicit null (Layer 1/2 path)

    const trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    expect(mockGetText).toHaveBeenCalledTimes(1);
    const translationService = (await import('../../src/services/stack-client.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });
    expect(translationService.translate.mock.calls[0][0]).toBe('fallback text');
  });

  it('SHOW_TRIGGER with empty-string text → treated as null, falls back to GET_TEXT', async () => {
    const { container } = render(<SelectionTranslator />);
    mockGetText.mockResolvedValue({ text: 'fetched after empty' });

    await fireShowTrigger({ text: '' });

    const trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    expect(mockGetText).toHaveBeenCalledTimes(1);
  });

  it('prefetched cleared after one use: a second SHOW_TRIGGER without text must fall back', async () => {
    const { container } = render(<SelectionTranslator />);
    mockGetText.mockResolvedValue({ text: 'second fetch' });

    // First: with text → click uses prefetched.
    await fireShowTrigger({ text: 'first' });
    let trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });
    expect(mockGetText).not.toHaveBeenCalled();

    // Second: no text → must fall back (if stale 'first' leaked, this would
    // mis-translate).
    await fireShowTrigger({ text: null });
    trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    expect(mockGetText).toHaveBeenCalledTimes(1);
    const translationService = (await import('../../src/services/stack-client.js')).default;
    await waitFor(() => {
      expect(translationService.translate.mock.calls.at(-1)[0]).toBe('second fetch');
    });
  });

  it('new SHOW_TRIGGER overrides a pending prefetched value (no click between them)', async () => {
    const { container } = render(<SelectionTranslator />);

    // Send 'firstSelection', do not click.
    await fireShowTrigger({ text: 'firstSelection' });
    // Send 'secondSelection' to overwrite.
    await fireShowTrigger({ text: 'secondSelection' });

    const trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    const translationService = (await import('../../src/services/stack-client.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });
    expect(translationService.translate.mock.calls[0][0]).toBe('secondSelection');
    expect(mockGetText).not.toHaveBeenCalled();
  });
});
