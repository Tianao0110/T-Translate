// Mount smoke test for SelectionTranslator — the selection-window component.
// Exists for the same reason as document-translator-mount.test.jsx: a missing
// lucide icon or a temporal-dead-zone hook slips past eslint and vite and only
// throws at first render. Rendering once is the whole point.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';

let triggerCb = null;

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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key, fallback) => (typeof fallback === 'string' ? fallback : _key), i18n: { language: 'zh' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const SelectionTranslator = (await import('../../src/components/SelectionTranslator/index.jsx')).default;

beforeEach(() => {
  triggerCb = null;
  global.window.electron = {
    selection: {
      onShowTrigger: (cb) => { triggerCb = cb; return () => { triggerCb = null; }; },
      onShowResult: () => () => {},
      onShowDirect: () => () => {},
      getText: vi.fn(),
      addToHistory: vi.fn(),
      notifyDestroyed: () => {},
      getWindowId: () => Promise.resolve(0),
      applyShowSource: () => {},
    },
  };
});

afterEach(() => {
  cleanup();
});

describe('SelectionTranslator mounts', () => {
  it('renders without throwing and subscribes to SHOW_TRIGGER', () => {
    render(<SelectionTranslator />);
    expect(triggerCb).toBeTruthy();
  });

  it('shows the trigger icon when SHOW_TRIGGER arrives', async () => {
    const { container } = render(<SelectionTranslator />);

    await act(async () => {
      triggerCb({
        mouseX: 100,
        mouseY: 100,
        theme: 'light',
        settings: { triggerTimeout: 4000, minChars: 2, maxChars: 500 },
        translation: { sourceLanguage: 'auto', targetLanguage: 'zh' },
      });
      await new Promise((r) => setTimeout(r, 120));
    });

    expect(container.querySelector('.sel-trigger')).toBeTruthy();
  });
});
