// RAF-aligned throttle for streaming translation output: at most one emit
// per animation frame, with a device-tier floor.

const HIGH_TIER_MS = 16; // ~60fps
const LOW_TIER_MS = 33; // ~30fps

// Chrome clamps navigator.deviceMemory to at most 8.
export function getFlushInterval(nav) {
  const n = nav || (typeof navigator !== 'undefined' ? navigator : {});
  const cores = n.hardwareConcurrency || 4;
  const memory = n.deviceMemory || 4;
  return cores >= 8 && memory >= 8 ? HIGH_TIER_MS : LOW_TIER_MS;
}

// emit() runs at most once per `interval`, aligned to an animation frame.
// Callers must cancel() once the stream settles. When the window is hidden
// RAF stops firing and buffered output waits for the final result.
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
