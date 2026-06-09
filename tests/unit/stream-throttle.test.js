// stream-throttle: device-tier interval selection + RAF-aligned flush behavior.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStreamThrottle, getFlushInterval } from '../../src/utils/stream-throttle.js';

describe('getFlushInterval', () => {
  it('returns 16ms for high-tier devices (≥8 cores and ≥8 reported GB)', () => {
    expect(getFlushInterval({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(16);
    expect(getFlushInterval({ hardwareConcurrency: 16, deviceMemory: 8 })).toBe(16);
  });

  it('returns 33ms when either cores or memory is below the bar', () => {
    expect(getFlushInterval({ hardwareConcurrency: 4, deviceMemory: 8 })).toBe(33);
    expect(getFlushInterval({ hardwareConcurrency: 8, deviceMemory: 4 })).toBe(33);
  });

  it('defaults to 33ms when fields are missing', () => {
    expect(getFlushInterval({})).toBe(33);
  });
});

describe('createStreamThrottle', () => {
  let rafCallbacks;

  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id) => {
      rafCallbacks[id - 1] = null;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const runRafFrame = () => {
    const cbs = rafCallbacks.splice(0);
    cbs.forEach((cb) => cb && cb(Date.now()));
  };

  it('coalesces a burst of schedules into a single emit', () => {
    const emit = vi.fn();
    const throttle = createStreamThrottle(emit, 16);

    for (let i = 0; i < 50; i++) throttle.schedule();
    expect(emit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);
    runRafFrame();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('enforces the minimum interval between consecutive emits', () => {
    const emit = vi.fn();
    const throttle = createStreamThrottle(emit, 33);

    throttle.schedule();
    vi.advanceTimersByTime(33);
    runRafFrame();
    expect(emit).toHaveBeenCalledTimes(1);

    throttle.schedule();
    vi.advanceTimersByTime(10);
    runRafFrame();
    expect(emit).toHaveBeenCalledTimes(1); // still inside the floor

    vi.advanceTimersByTime(23);
    runRafFrame();
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('emit sees the latest buffered state, not the state at schedule time', () => {
    let buffer = '';
    const seen = [];
    const throttle = createStreamThrottle(() => seen.push(buffer), 16);

    buffer += 'a';
    throttle.schedule();
    buffer += 'b';
    throttle.schedule();
    buffer += 'c';

    vi.advanceTimersByTime(16);
    runRafFrame();
    expect(seen).toEqual(['abc']);
  });

  it('cancel() drops a flush still waiting on the timer', () => {
    const emit = vi.fn();
    const throttle = createStreamThrottle(emit, 16);

    throttle.schedule();
    throttle.cancel();
    vi.advanceTimersByTime(100);
    runRafFrame();
    expect(emit).not.toHaveBeenCalled();
  });

  it('cancel() drops a flush already queued on RAF', () => {
    const emit = vi.fn();
    const throttle = createStreamThrottle(emit, 16);

    throttle.schedule();
    vi.advanceTimersByTime(16); // timer fired, RAF queued
    throttle.cancel();
    runRafFrame();
    expect(emit).not.toHaveBeenCalled();
  });

  it('schedule() after cancel() is a no-op', () => {
    const emit = vi.fn();
    const throttle = createStreamThrottle(emit, 16);

    throttle.cancel();
    throttle.schedule();
    vi.advanceTimersByTime(100);
    runRafFrame();
    expect(emit).not.toHaveBeenCalled();
  });
});
