// Phase B pass-through 单测 — v0.2.5
// 验：SHOW_TRIGGER 带 text 时 renderer 用 ref 存下来；点击图标先用 ref 再 fallback GET_TEXT；
//     用过即清；新 SHOW_TRIGGER 覆盖。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

// === 抓 listener callback 的 holder ===
let triggerCb = null;

// === Mocks（vi.mock 必须在所有 import 之前；vitest hoists 到顶）===

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

  // 设置 window.electron mock，每次 useEffect 注册都被捕获
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

// 工厂：触发 onShowTrigger callback 并等 React state flush
async function fireShowTrigger(data) {
  await act(async () => {
    triggerCb({
      mouseX: 100, mouseY: 100,
      rect: { x: 100, y: 100, width: 50, height: 20 },
      theme: 'light',
      settings: { triggerTimeout: 4000, minChars: 2, maxChars: 500 },
      translation: { sourceLanguage: 'auto', targetLanguage: 'zh' },
      ...data,
    });
    // flush 100ms triggerReady 定时器（让图标 ready 接收点击）
    await new Promise(r => setTimeout(r, 120));
  });
}

describe('Phase B — text pass-through via SHOW_TRIGGER', () => {
  it('SHOW_TRIGGER 带 text → 点击图标用 prefetched，不发 GET_TEXT', async () => {
    const { container } = render(<SelectionTranslator />);
    expect(triggerCb).toBeTruthy();

    await fireShowTrigger({ text: 'hello world' });

    const trigger = container.querySelector('.sel-trigger');
    expect(trigger).toBeTruthy();

    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    // 关键断言：translate 被 'hello world' 调用，getText IPC 没被调
    const translationService = (await import('../../src/services/translation.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });
    expect(translationService.translate.mock.calls[0][0]).toBe('hello world');
    expect(mockGetText).not.toHaveBeenCalled();
  });

  it('SHOW_TRIGGER 不带 text（Layer 1/2）→ 点击图标 fallback GET_TEXT', async () => {
    const { container } = render(<SelectionTranslator />);
    mockGetText.mockResolvedValue({ text: 'fallback text' });

    await fireShowTrigger({ text: null });  // 显式 null（Layer 1/2 路径）

    const trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    expect(mockGetText).toHaveBeenCalledTimes(1);
    const translationService = (await import('../../src/services/translation.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });
    expect(translationService.translate.mock.calls[0][0]).toBe('fallback text');
  });

  it('SHOW_TRIGGER 带空字符串 text → 视为 null fallback GET_TEXT', async () => {
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

  it('点击使用一次后 prefetched 清空：第二次 SHOW_TRIGGER 不带 text 必须走 fallback', async () => {
    const { container } = render(<SelectionTranslator />);
    mockGetText.mockResolvedValue({ text: 'second fetch' });

    // 第一次：带 text 点击用 prefetched
    await fireShowTrigger({ text: 'first' });
    let trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });
    expect(mockGetText).not.toHaveBeenCalled();

    // 第二次：不带 text，应该 fallback（如果没清，会错用 'first'）
    await fireShowTrigger({ text: null });
    trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    expect(mockGetText).toHaveBeenCalledTimes(1);
    const translationService = (await import('../../src/services/translation.js')).default;
    await waitFor(() => {
      expect(translationService.translate.mock.calls.at(-1)[0]).toBe('second fetch');
    });
  });

  it('新 SHOW_TRIGGER 覆盖旧 prefetched（不点第一次直接 fire 第二次）', async () => {
    const { container } = render(<SelectionTranslator />);

    // 先送 'firstSelection' 不点
    await fireShowTrigger({ text: 'firstSelection' });
    // 再送 'secondSelection' 覆盖
    await fireShowTrigger({ text: 'secondSelection' });

    const trigger = container.querySelector('.sel-trigger');
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise(r => setTimeout(r, 50));
    });

    const translationService = (await import('../../src/services/translation.js')).default;
    await waitFor(() => {
      expect(translationService.translate).toHaveBeenCalled();
    });
    expect(translationService.translate.mock.calls[0][0]).toBe('secondSelection');
    expect(mockGetText).not.toHaveBeenCalled();
  });
});
