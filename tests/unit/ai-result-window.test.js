// AI result windows: the ownership rules from the design's linkage table (a
// result never outlives the card it came from; closing a result leaves that
// card alone) and the fit-to-content sizing. Drives the real IPC handlers
// against a fake BrowserWindow.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// shared/paths.js builds packaged paths from process.resourcesPath, which only
// exists inside Electron.
process.resourcesPath = process.resourcesPath || '/mock/resources';

const register = (await import('../../electron/ipc/ai-result.js')).default;

const handlers = new Map();
const created = [];

class FakeResultWindow {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.visible = false;
    this.closeCalls = 0;
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    this._on = {};
    created.push(this);
  }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  show() { this.visible = true; }
  getBounds() { return { ...this.bounds }; }
  setBounds(next) { this.bounds = { ...this.bounds, ...next }; }
  setAlwaysOnTop() {}
  loadURL() {}
  loadFile() {}
  once(event, cb) { this._on[event] = cb; }
  on(event, cb) { this._on[event] = cb; }
  emit(event) { this._on[event]?.(); }
  close() {
    this.closeCalls++;
    this.destroyed = true;
    this._on.closed?.();
  }
}

// Stand-in for a selection card / floating window: records the lifecycle
// listeners the module attaches so a test can fire them.
function makeOwner(id) {
  const listeners = new Map();
  const add = (event, cb) => listeners.set(event, [...(listeners.get(event) || []), cb]);
  return {
    id,
    isDestroyed: () => false,
    getBounds: () => ({ x: 100, y: 100, width: 400, height: 200 }),
    on: add,
    once: add,
    emit: (event) => (listeners.get(event) || []).forEach(cb => cb()),
  };
}

function open(ownerWindow, payload = {}) {
  return handlers.get('ai-result:open')(
    { sender: { __ownerWindow: ownerWindow } },
    { content: 'summary', ...payload }
  );
}

// The module takes its platform pieces through ctx, so no real Electron and no
// display enumeration are involved.
const ctx = {
  electron: {
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
      on: (channel, fn) => handlers.set(channel, fn),
    },
    BrowserWindow: Object.assign(
      function (options) { return new FakeResultWindow(options); },
      { fromWebContents: (wc) => wc?.__ownerWindow || null }
    ),
  },
  displayHelper: { ensureBoundsOnDisplay: (bounds) => ({ ...bounds, adjusted: false }) },
};

beforeEach(() => {
  handlers.clear();
  created.length = 0;
  register(ctx);
});

describe('AI result window ownership', () => {
  it('opens a window and serves its payload back to it', async () => {
    const owner = makeOwner(1);
    const result = await open(owner, { title: '总结', content: 'three points', provider: 'OpenAI' });

    expect(result.success).toBe(true);
    expect(created).toHaveLength(1);

    const payload = await handlers.get('ai-result:payload')({}, result.id);
    expect(payload).toMatchObject({ title: '总结', content: 'three points', provider: 'OpenAI' });
  });

  it('replaces the previous result from the same card instead of stacking', async () => {
    const owner = makeOwner(1);
    const first = await open(owner);
    await open(owner);

    expect(created[0].closeCalls).toBe(1);
    expect(await handlers.get('ai-result:payload')({}, first.id)).toBeNull();
    expect(created[1].isDestroyed()).toBe(false);
  });

  it('closes results when the owning card hides — a hidden card is a finished session', async () => {
    const owner = makeOwner(1);
    await open(owner);

    owner.emit('hide');

    expect(created[0].isDestroyed()).toBe(true);
  });

  it('closes results when the owning card is destroyed', async () => {
    const owner = makeOwner(1);
    await open(owner);

    owner.emit('closed');

    expect(created[0].isDestroyed()).toBe(true);
  });

  it('leaves another card’s results alone', async () => {
    const cardA = makeOwner(1);
    const cardB = makeOwner(2);
    await open(cardA);
    await open(cardB);

    cardA.emit('hide');

    expect(created[0].isDestroyed()).toBe(true);
    expect(created[1].isDestroyed()).toBe(false);
  });

  it('closing a result window does not touch the card that spawned it', async () => {
    const owner = makeOwner(1);
    const result = await open(owner);

    expect(await handlers.get('ai-result:close')({}, result.id)).toBe(true);
    expect(created[0].isDestroyed()).toBe(true);
    expect(owner.isDestroyed()).toBe(false);
  });

  it('opens opaque with a per-theme background — no transparent reading pane', async () => {
    await open(makeOwner(1), { theme: 'dark' });

    expect(created[0].options.transparent).toBe(false);
    expect(created[0].options.backgroundColor).toBe('#211f1d');
  });

  it('falls back to the light background for an unknown theme', async () => {
    await open(makeOwner(1), { theme: 'neon' });

    expect(created[0].options.backgroundColor).toBe('#f7f8fa');
  });

  it('refuses to open without an identifiable owner window', async () => {
    const result = await handlers.get('ai-result:open')({ sender: {} }, { content: 'x' });

    expect(result.success).toBe(false);
    expect(created).toHaveLength(0);
  });
});

describe('AI result window sizing', () => {
  const report = (id, height) => handlers.get('ai-result:resize')({}, { id, height });

  it('takes the height the renderer measured for its text', async () => {
    const result = await open(makeOwner(1));

    report(result.id, 268);

    expect(created[0].getBounds().height).toBe(268);
    expect(created[0].getBounds().width).toBe(420); // reading column stays fixed
  });

  it('does not shrink below a usable minimum', async () => {
    const result = await open(makeOwner(1));

    report(result.id, 20);

    expect(created[0].getBounds().height).toBe(140);
  });

  it('caps the height and lets long content scroll instead', async () => {
    const result = await open(makeOwner(1));

    report(result.id, 4000);

    expect(created[0].getBounds().height).toBe(720);
  });

  it('stays hidden until the height is settled, then shows', async () => {
    const result = await open(makeOwner(1));
    created[0].emit('ready-to-show');

    expect(created[0].isVisible()).toBe(false);

    report(result.id, 300);

    expect(created[0].isVisible()).toBe(true);
  });

  it('shows anyway when the renderer never reports a height', async () => {
    vi.useFakeTimers();
    try {
      await open(makeOwner(1));
      created[0].emit('ready-to-show');

      vi.advanceTimersByTime(1000);

      expect(created[0].isVisible()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a nonsense height', async () => {
    const result = await open(makeOwner(1));
    const before = created[0].getBounds().height;

    report(result.id, 0);
    report(result.id, undefined);

    expect(created[0].getBounds().height).toBe(before);
  });
});
