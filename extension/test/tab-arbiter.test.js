// @vitest-environment node
//
// The tab arbiter over fake chrome.tabs / chrome.windows: the focused
// window's active tab, every window's active tab in focus order, and the
// bookkeeping on activation, focus changes and removals.

import { describe, it, expect, vi } from 'vitest';
import { createTabArbiter } from '../src/sw/tab-arbiter.js';

function listenerSet() {
  const fns = [];
  return { addListener: (fn) => fns.push(fn), fire: (...a) => fns.forEach((fn) => fn(...a)) };
}

function setup({ active = [{ id: 1, windowId: 10 }, { id: 2, windowId: 20 }], focused = 10 } = {}) {
  const tabs = { query: vi.fn(async () => active), onActivated: listenerSet(), onRemoved: listenerSet() };
  const windows = { WINDOW_ID_NONE: -1, getLastFocused: vi.fn(async () => ({ id: focused, focused: true })), onFocusChanged: listenerSet(), onRemoved: listenerSet() };
  const changes = vi.fn();
  const arb = createTabArbiter({ tabs, windows, onChange: changes });
  return { tabs, windows, arb, changes };
}

describe('tab arbiter', () => {
  it('starts from the active tabs and the focused window', async () => {
    const { arb, changes } = setup();
    expect(arb.focused()).toBeNull();
    await arb.init();
    expect(arb.focused()).toBe(1);
    expect(arb.visible()).toEqual([1, 2]);
    expect(arb.isVisible(2)).toBe(true);
    expect(arb.isVisible(3)).toBe(false);
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('follows activation and focus; removed windows and tabs drop out', async () => {
    const { arb, tabs, windows, changes } = setup();
    await arb.init();
    tabs.onActivated.fire({ tabId: 3, windowId: 10 });
    expect(arb.focused()).toBe(3);
    expect(arb.isVisible(1)).toBe(false);
    windows.onFocusChanged.fire(20);
    expect(arb.focused()).toBe(2);
    expect(arb.visible()).toEqual([2, 3]);
    windows.onFocusChanged.fire(-1);
    expect(arb.focused()).toBe(2);
    tabs.onRemoved.fire(2);
    expect(arb.focused()).toBeNull();
    expect(arb.visible()).toEqual([3]);
    windows.onRemoved.fire(20);
    expect(arb.focused()).toBe(3);
    expect(changes.mock.calls.length).toBeGreaterThan(4);
  });

  it('survives missing chrome APIs', async () => {
    const arb = createTabArbiter({ tabs: undefined, windows: undefined });
    await arb.init();
    expect(arb.focused()).toBeNull();
    expect(arb.visible()).toEqual([]);
  });
});
