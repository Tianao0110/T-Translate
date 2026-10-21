// The selection card explains code, stack traces and formulas instead of
// translating them (components/SelectionTranslator): only with the setting on
// and a chat model available, falling back to the translation otherwise or
// when the explanation fails; an explanation enters history as its own kind.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';

const stack = vi.hoisted(() => ({
  translate: vi.fn(),
  chatCompletion: vi.fn(),
  getChatCapability: vi.fn(),
}));

vi.mock('../../../src/translation/stack-client.js', () => ({
  default: {
    initialized: true,
    init: vi.fn(() => Promise.resolve()),
    translate: (...a) => stack.translate(...a),
    detectLanguage: vi.fn(() => Promise.resolve({ language: 'en', inTarget: false })),
    chatCompletion: (...a) => stack.chatCompletion(...a),
    getChatCapability: (...a) => stack.getChatCapability(...a),
    getVisionCapability: vi.fn(() => Promise.resolve({ available: false })),
    onChanged: vi.fn(() => () => {}),
  },
}));

vi.mock('../../../src/ai/ai-action-store.js', () => ({
  ensureImportedActions: vi.fn(() => Promise.resolve([])),
  refreshImportedActions: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../../src/tts/index.js', () => ({
  default: { init: vi.fn(() => Promise.resolve()), stop: vi.fn(), speak: vi.fn(), onStatusChange: vi.fn() },
  TTS_STATUS: { IDLE: 'idle', SPEAKING: 'speaking', STOPPED: 'stopped' },
}));

vi.mock('../../../src/core/logger.js', () => ({
  default: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, fallback) => (typeof fallback === 'string' ? fallback : key), i18n: { language: 'zh' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const SelectionTranslator = (await import('../../../src/components/SelectionTranslator/index.jsx')).default;

const CODE = 'const doubled = items.map((x) => x * 2);';
const PROSE = 'Pinned screenshots stay on top of other windows.';

let directCb;
let addToHistory;

beforeEach(() => {
  directCb = null;
  addToHistory = vi.fn();
  stack.translate.mockReset().mockResolvedValue({ success: true, text: 'TRANSLATED' });
  stack.chatCompletion.mockReset().mockResolvedValue({ success: true, content: 'EXPLAINED' });
  stack.getChatCapability.mockReset().mockResolvedValue({ available: true, providerId: 'tengine' });
  global.window.electron = {
    selection: {
      onShowTrigger: () => () => {},
      onShowResult: () => () => {},
      onShowDirect: (cb) => { directCb = cb; return () => {}; },
      getText: vi.fn(),
      addToHistory,
      attachAiResult: vi.fn(),
      notifyDestroyed: () => {},
      getWindowId: () => Promise.resolve(0),
      applyShowSource: () => {},
    },
  };
});

afterEach(() => cleanup());

async function select(text, settings = {}) {
  const view = render(<SelectionTranslator />);
  // Let the chat-capability probe land before the selection arrives.
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  await act(async () => {
    await directCb({
      text,
      phase: 'translate',
      mouseX: 100,
      mouseY: 100,
      theme: 'light',
      settings: { minChars: 2, maxChars: 2000, ...settings },
      translation: { sourceLanguage: 'auto', targetLanguage: 'zh' },
    });
    await new Promise((r) => setTimeout(r, 20));
  });
  return view;
}

describe('selection card: explain instead of translate', () => {
  it('code with a chat model is explained, and recorded as an explanation', async () => {
    const { container } = await select(CODE);
    expect(stack.chatCompletion).toHaveBeenCalledTimes(1);
    expect(stack.chatCompletion.mock.calls[0][0][1].content).toMatch(/这段代码|Explain the following code/);
    expect(stack.translate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('EXPLAINED');
    expect(addToHistory).toHaveBeenCalledWith(expect.objectContaining({ result: 'EXPLAINED', kind: 'understand', actionId: 'explain', from: 'hotkey' }));
  });

  it('ordinary text is translated as before', async () => {
    const { container } = await select(PROSE);
    expect(stack.chatCompletion).not.toHaveBeenCalled();
    expect(container.textContent).toContain('TRANSLATED');
    expect(addToHistory.mock.calls[0][0].kind).toBeUndefined();
  });

  it('without a chat model, code is translated', async () => {
    stack.getChatCapability.mockResolvedValue({ available: false });
    await select(CODE);
    expect(stack.chatCompletion).not.toHaveBeenCalled();
    expect(stack.translate).toHaveBeenCalledTimes(1);
  });

  it('with the setting off, code is translated', async () => {
    await select(CODE, { autoExplain: false });
    expect(stack.chatCompletion).not.toHaveBeenCalled();
    expect(stack.translate).toHaveBeenCalledTimes(1);
  });

  it('a failed explanation falls back to the translation', async () => {
    stack.chatCompletion.mockResolvedValue({ success: false, error: 'model gone' });
    const { container } = await select(CODE);
    expect(stack.translate).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('TRANSLATED');
    expect(addToHistory.mock.calls[0][0].kind).toBeUndefined();
  });
});
