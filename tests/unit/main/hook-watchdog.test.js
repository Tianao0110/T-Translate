// createHookWatchdog with a fake clock, cursor and interval: a restart needs
// the cursor moving through consecutive checks with no hook event, and
// restarts are spaced out.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  createHookWatchdog, CHECK_INTERVAL_MS, MIN_RESTART_GAP_MS,
} = require('../../../electron/selection/hook-watchdog.js');

describe('createHookWatchdog', () => {
  let t;
  let cursor;
  let tick;
  let cleared;
  let restarts;
  let dog;

  // One interval: optional cursor move and hook event, then the check.
  const step = ({ move = false, event = false } = {}) => {
    t += CHECK_INTERVAL_MS;
    if (move) cursor = { x: cursor.x + 5, y: cursor.y };
    if (event) dog.noteEvent();
    tick();
  };

  beforeEach(() => {
    t = 1000;
    cursor = { x: 100, y: 100 };
    restarts = 0;
    cleared = 0;
    dog = createHookWatchdog({
      getCursor: () => cursor,
      restart: () => { restarts += 1; },
      now: () => t,
      timers: {
        setInterval: (fn) => { tick = fn; return { unref() {} }; },
        clearInterval: () => { cleared += 1; },
      },
    });
    dog.start();
  });

  it('stays quiet while hook events follow the cursor', () => {
    for (let i = 0; i < 5; i++) step({ move: true, event: true });
    expect(restarts).toBe(0);
  });

  it('restarts after two checks of movement without events', () => {
    step({ move: true });
    expect(restarts).toBe(0);
    step({ move: true });
    expect(restarts).toBe(1);
  });

  it('ignores silence while the cursor stands still', () => {
    for (let i = 0; i < 5; i++) step();
    expect(restarts).toBe(0);
  });

  it('a hook event clears an earlier silent check', () => {
    step({ move: true });
    step({ move: true, event: true });
    step({ move: true });
    expect(restarts).toBe(0);
  });

  it('spaces restarts at least the minimum gap apart', () => {
    step({ move: true });
    step({ move: true });
    expect(restarts).toBe(1);
    const checksInGap = Math.floor(MIN_RESTART_GAP_MS / CHECK_INTERVAL_MS) - 1;
    for (let i = 0; i < checksInGap; i++) step({ move: true });
    expect(restarts).toBe(1);
    step({ move: true });
    expect(restarts).toBe(2);
  });

  it('stop clears the interval', () => {
    dog.stop();
    expect(cleared).toBe(1);
  });
});
