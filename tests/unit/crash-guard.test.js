// Crash guard: startup probation counting, healthy-mark semantics (including
// the losing single-instance duplicate that must not wipe counters), and the
// renderer auto-reload window with its give-up escalation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createCrashGuard,
  SAFE_MODE_THRESHOLD,
  STARTUP_STABLE_MS,
  RENDERER_CRASH_WINDOW_MS,
  MAX_RENDERER_RELOADS,
} from '../../electron/utils/crash-guard.js';

function makeStore(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    get: (key, def) => (data.has(key) ? data.get(key) : def),
    set: (key, value) => data.set(key, value),
    _data: data,
  };
}

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

// Minimal BrowserWindow stand-in: captures the render-process-gone handler so
// tests can fire it directly.
function makeWin() {
  const handlers = {};
  return {
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    webContents: {
      on: (event, cb) => { handlers[event] = cb; },
      reload: vi.fn(),
    },
    fire(details) { handlers['render-process-gone'](null, details); },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('startup probation', () => {
  it('first launch: zero failures, pending flag set', () => {
    const store = makeStore();
    const guard = createCrashGuard({ store, logger: noopLogger });

    expect(guard.beginStartupProbation()).toBe(0);
    expect(store.get('crashGuard.startupPending')).toBe(true);
  });

  it('a leftover pending flag counts as one failure and persists', () => {
    const store = makeStore({ 'crashGuard.startupPending': true });
    const guard = createCrashGuard({ store, logger: noopLogger });

    expect(guard.beginStartupProbation()).toBe(1);
    expect(store.get('crashGuard.consecutiveStartupFailures')).toBe(1);
  });

  it('reaches the safe-mode threshold after consecutive dirty launches', () => {
    const store = makeStore({
      'crashGuard.startupPending': true,
      'crashGuard.consecutiveStartupFailures': SAFE_MODE_THRESHOLD - 1,
    });
    const guard = createCrashGuard({ store, logger: noopLogger });

    expect(guard.beginStartupProbation()).toBe(SAFE_MODE_THRESHOLD);
  });

  it('markStartupHealthy clears the flag and the counter', () => {
    const store = makeStore({
      'crashGuard.startupPending': true,
      'crashGuard.consecutiveStartupFailures': 2,
    });
    const guard = createCrashGuard({ store, logger: noopLogger });

    guard.beginStartupProbation();
    guard.markStartupHealthy('test');

    expect(store.get('crashGuard.startupPending')).toBe(false);
    expect(store.get('crashGuard.consecutiveStartupFailures')).toBe(0);
  });

  it('markStartupHealthy is a no-op when probation never started (losing duplicate)', () => {
    const store = makeStore({
      'crashGuard.startupPending': true,
      'crashGuard.consecutiveStartupFailures': 2,
    });
    const guard = createCrashGuard({ store, logger: noopLogger });

    // Second instance: quits via before-quit without beginStartupProbation.
    guard.markStartupHealthy('clean-quit');

    expect(store.get('crashGuard.startupPending')).toBe(true);
    expect(store.get('crashGuard.consecutiveStartupFailures')).toBe(2);
  });

  it('surviving the stability window clears the counters', () => {
    vi.useFakeTimers();
    try {
      const store = makeStore({ 'crashGuard.startupPending': true });
      const guard = createCrashGuard({ store, logger: noopLogger });

      guard.beginStartupProbation(); // failures -> 1, pending re-set
      guard.scheduleStableMark();

      vi.advanceTimersByTime(STARTUP_STABLE_MS + 1);

      expect(store.get('crashGuard.startupPending')).toBe(false);
      expect(store.get('crashGuard.consecutiveStartupFailures')).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forceSafeModeNextLaunch pre-loads the threshold without a pending flag', () => {
    const store = makeStore();
    const guard = createCrashGuard({ store, logger: noopLogger });

    guard.beginStartupProbation();
    guard.forceSafeModeNextLaunch();

    expect(store.get('crashGuard.consecutiveStartupFailures')).toBe(SAFE_MODE_THRESHOLD);
    expect(store.get('crashGuard.startupPending')).toBe(false);

    // The relaunch itself must not stack another failure on top.
    const nextGuard = createCrashGuard({ store, logger: noopLogger });
    expect(nextGuard.beginStartupProbation()).toBe(SAFE_MODE_THRESHOLD);
  });
});

describe('renderer recovery', () => {
  function attach({ now, isQuitting } = {}) {
    const guard = createCrashGuard({ store: makeStore(), logger: noopLogger, now });
    const win = makeWin();
    const onGiveUp = vi.fn();
    guard.attachRendererRecovery(win, {
      name: 'Test window',
      onGiveUp,
      isQuitting: isQuitting || (() => false),
    });
    return { win, onGiveUp };
  }

  it('abnormal death triggers a reload', () => {
    const { win } = attach();
    win.fire({ reason: 'crashed', exitCode: 5 });
    expect(win.webContents.reload).toHaveBeenCalledTimes(1);
  });

  it('clean-exit and killed do not reload', () => {
    const { win } = attach();
    win.fire({ reason: 'clean-exit' });
    win.fire({ reason: 'killed' });
    expect(win.webContents.reload).not.toHaveBeenCalled();
  });

  it('no action while quitting or after destroy', () => {
    const { win } = attach({ isQuitting: () => true });
    win.fire({ reason: 'crashed' });
    expect(win.webContents.reload).not.toHaveBeenCalled();

    const second = attach();
    second.win.destroyed = true;
    second.win.fire({ reason: 'crashed' });
    expect(second.win.webContents.reload).not.toHaveBeenCalled();
  });

  it('gives up past the limit inside the window, without reloading', () => {
    let t = 1_000_000;
    const { win, onGiveUp } = attach({ now: () => t });

    for (let i = 0; i < MAX_RENDERER_RELOADS; i++) {
      win.fire({ reason: 'crashed' });
      t += 1000;
    }
    expect(win.webContents.reload).toHaveBeenCalledTimes(MAX_RENDERER_RELOADS);
    expect(onGiveUp).not.toHaveBeenCalled();

    win.fire({ reason: 'oom' });
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(win.webContents.reload).toHaveBeenCalledTimes(MAX_RENDERER_RELOADS);
  });

  it('old crashes slide out of the window — sparse crashes reload forever', () => {
    let t = 1_000_000;
    const { win, onGiveUp } = attach({ now: () => t });

    // One crash every window-and-a-bit: never more than one in any window.
    for (let i = 0; i < MAX_RENDERER_RELOADS + 3; i++) {
      win.fire({ reason: 'crashed' });
      t += RENDERER_CRASH_WINDOW_MS + 1000;
    }

    expect(onGiveUp).not.toHaveBeenCalled();
    expect(win.webContents.reload).toHaveBeenCalledTimes(MAX_RENDERER_RELOADS + 3);
  });
});
