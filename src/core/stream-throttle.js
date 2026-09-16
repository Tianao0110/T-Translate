// RAF-aligned throttle for streaming translation output.
// Tokens can arrive at hundreds per second; emitting at most once per animation
// frame (with a device-tier floor) caps downstream setState/serialize work
// without visible lag.

const HIGH_TIER_MS = 16; // ~60fps
const LOW_TIER_MS = 33; // ~30fps

// Chrome clamps navigator.deviceMemory to at most 8, so ">= 8" is the top
// bucket (a 16GB machine still reports 8).
export function getFlushInterval(nav) {
  const n = nav || (typeof navigator !== 'undefined' ? navigator : {});
  const cores = n.hardwareConcurrency || 4;
  const memory = n.deviceMemory || 4;
  return cores >= 8 && memory >= 8 ? HIGH_TIER_MS : LOW_TIER_MS;
}

// emit() runs at most once per `interval`, aligned to an animation frame so the
// paint lands on the same vsync. Callers MUST cancel() once the stream settles:
// a flush firing after the final result is applied would overwrite it with a
// stale partial. When the window is hidden RAF stops firing — buffered output
// then waits for the final (non-throttled) result, which is the desired
// "don't render what nobody sees" behavior.
export function createStreamThrottle(emit, interval = getFlushInterval()) {
  let timerId = null;
  let rafId = null;
  let lastEmit = 0;
  let cancelled = false;
  const hasRaf = typeof requestAnimationFrame === 'function';

  const flush = () => {
    rafId = null;
    if (cancelled) return;
    lastEmit = Date.now();
    emit();
  };

  const schedule = () => {
    if (cancelled || timerId !== null || rafId !== null) return;
    const wait = Math.max(0, interval - (Date.now() - lastEmit));
    timerId = setTimeout(() => {
      timerId = null;
      if (cancelled) return;
      if (hasRaf) {
        rafId = requestAnimationFrame(flush);
      } else {
        flush();
      }
    }, wait);
  };

  const cancel = () => {
    cancelled = true;
    if (timerId !== null) clearTimeout(timerId);
    if (rafId !== null && hasRaf) cancelAnimationFrame(rafId);
    timerId = null;
    rafId = null;
  };

  return { schedule, cancel };
}
