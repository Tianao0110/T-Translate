// AI results reuse the selection card: spawned pinned beside the requesting
// window, handed the finished text on the display-only path, and standalone
// from then on (the source card closing must not take it along).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const register = (await import('../../electron/ipc/ai-result.js')).default;

const handlers = new Map();
const sent = [];
let created = [];
let cardCounter = 0;
let refuse = null;

function fakeCard() {
  const listeners = {};
  return {
    destroyed: false,
    shown: false,
    isDestroyed() { return this.destroyed; },
    showInactive() { this.shown = true; },
    webContents: {
      once: (event, cb) => { listeners[event] = cb; },
      send: (channel, payload) => sent.push({ channel, payload }),
    },
    finishLoad() { listeners['did-finish-load']?.(); },
  };
}

const ctx = {
  electron: {
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    BrowserWindow: { fromWebContents: (wc) => wc?.__window || null },
  },
  windowManager: {
    createAiResultWindow: vi.fn(() => {
      if (refuse) return refuse;
      const window = fakeCard();
      created.push(window);
      return { success: true, windowId: ++cardCounter, window };
    }),
  },
  store: { get: () => ({ interface: { theme: 'dark' } }) },
};

const requester = { getBounds: () => ({ x: 100, y: 100, width: 400, height: 200 }), isDestroyed: () => false };

const show = (payload = {}) => handlers.get('ai-result:show')(
  { sender: { __window: requester } },
  { sourceText: 'source paragraph', content: 'three key points', actionLabel: '总结', ...payload }
);

beforeEach(() => {
  handlers.clear();
  sent.length = 0;
  created = [];
  cardCounter = 0;
  refuse = null;
  ctx.windowManager.createAiResultWindow.mockClear();
  register(ctx);
});

describe('AI result card', () => {
  it('spawns a card beside the window that asked for it', () => {
    const result = show();

    expect(result).toMatchObject({ success: true, windowId: 1 });
    expect(ctx.windowManager.createAiResultWindow).toHaveBeenCalledWith({
      x: 100, y: 100, width: 400, height: 200,
    });
  });

  it('hands over the finished text on the display-only path', () => {
    show();
    created[0].finishLoad();

    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe('selection:show-result');
    expect(sent[0].payload).toMatchObject({
      sourceText: 'source paragraph',
      translatedText: 'three key points',
      aiAction: '总结',
    });
    // No bare `text` field — that would send the card off to translate it again
    expect(sent[0].payload.text).toBeUndefined();
  });

  it('is born pinned, so a later selection cannot overwrite it', () => {
    show();
    created[0].finishLoad();

    expect(sent[0].payload).toMatchObject({ frozen: true, windowId: 1 });
  });

  it('follows the app theme', () => {
    show();
    created[0].finishLoad();

    expect(sent[0].payload.theme).toBe('dark');
  });

  it('only shows once the content is in — no empty card flash', () => {
    show();
    expect(created[0].shown).toBe(false);

    created[0].finishLoad();
    expect(created[0].shown).toBe(true);
  });

  it('says nothing to a card that died before it loaded', () => {
    show();
    created[0].destroyed = true;
    created[0].finishLoad();

    expect(sent).toHaveLength(0);
  });

  it('passes the pinned-card limit refusal straight back', () => {
    refuse = { success: false, error: 'limit' };

    expect(show()).toMatchObject({ success: false, error: 'limit' });
  });

  it('still opens when the requesting window is gone', () => {
    const result = handlers.get('ai-result:show')({ sender: {} }, { content: 'x' });

    expect(result.success).toBe(true);
    expect(ctx.windowManager.createAiResultWindow).toHaveBeenCalledWith(null);
  });
});
