// The work clock: open jobs, the short tail after the last one, a job run
// through track() (thrown or not), and clear() when a host goes away.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createWorkClock, SETTLE_MS } = require('../../../electron/tengine/work-clock.js');

describe('work clock', () => {
  it('working while a job is open and for the tail after the last one', () => {
    let t = 0;
    const w = createWorkClock({ now: () => t });
    expect(w.working()).toBe(false);
    const a = w.begin();
    const b = w.begin('b');
    t += 10000;
    expect(w.working()).toBe(true);
    w.end(a);
    expect(w.working()).toBe(true); // b still open
    w.end(b);
    w.end(b); // twice: no new tail
    t += SETTLE_MS - 1;
    expect(w.working()).toBe(true);
    t += 1;
    expect(w.working()).toBe(false);
  });

  it('track() is one job, ended when it throws too; clear() drops the open ones', async () => {
    let t = 0;
    const w = createWorkClock({ now: () => t, settleMs: 100 });
    let inside = null;
    await expect(
      w.track(async () => {
        inside = w.working();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(inside).toBe(true);
    t += 100;
    expect(w.working()).toBe(false);
    w.begin();
    w.clear();
    expect(w.working()).toBe(true);
    t += 100;
    expect(w.working()).toBe(false);
  });
});
