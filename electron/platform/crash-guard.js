// Crash guard: startup probation (a dirty flag in the store that counts
// consecutive failed launches and asks main.js for safe mode) and bounded
// renderer auto-reload with a per-window give-up callback. Dependency-injected,
// no require('electron'). Rules: docs/design/main-process.md §2.

const SAFE_MODE_THRESHOLD = 3;
const STARTUP_STABLE_MS = 60_000;
const RENDERER_CRASH_WINDOW_MS = 3 * 60_000;
const MAX_RENDERER_RELOADS = 3;

// Reasons that mean the renderer died on its own (not clean-exit / killed).
const ABNORMAL_REASONS = new Set([
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
  'abnormal-exit',
]);

function createCrashGuard({ store, logger, now = Date.now }) {
  // Only the instance that owns the single-instance lock runs probation.
  let probationStarted = false;
  let stableTimer = null;

  // Once at launch: returns the consecutive failed launches before this one.
  function beginStartupProbation() {
    const wasPending = store.get('crashGuard.startupPending', false);
    let failures = store.get('crashGuard.consecutiveStartupFailures', 0);

    if (wasPending) {
      failures = Math.min(failures + 1, 99);
      store.set('crashGuard.consecutiveStartupFailures', failures);
      logger.warn(`Previous launch never reached stable/clean exit (consecutive failures: ${failures})`);
    }

    store.set('crashGuard.startupPending', true);
    probationStarted = true;
    return failures;
  }

  // Surviving STARTUP_STABLE_MS counts as a healthy launch.
  function scheduleStableMark() {
    if (!probationStarted || stableTimer) return;
    stableTimer = setTimeout(() => markStartupHealthy('stable'), STARTUP_STABLE_MS);
    stableTimer.unref?.();
  }

  // Healthy launch (stable or a deliberate quit): clear flag and counter.
  function markStartupHealthy(why) {
    if (!probationStarted) return;
    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
    if (store.get('crashGuard.startupPending', false) ||
        store.get('crashGuard.consecutiveStartupFailures', 0) > 0) {
      store.set('crashGuard.startupPending', false);
      store.set('crashGuard.consecutiveStartupFailures', 0);
      logger.debug?.(`Startup marked healthy (${why})`);
    }
  }

  // The next launch boots straight into safe mode (pending stays false).
  function forceSafeModeNextLaunch() {
    store.set('crashGuard.consecutiveStartupFailures', SAFE_MODE_THRESHOLD);
    store.set('crashGuard.startupPending', false);
  }

  // Abnormal renderer death reloads in place; more than MAX_RENDERER_RELOADS
  // inside RENDERER_CRASH_WINDOW_MS calls onGiveUp instead.
  function attachRendererRecovery(win, { name, onGiveUp, isQuitting = () => false }) {
    const crashTimes = [];

    win.webContents.on('render-process-gone', (_event, details) => {
      const reason = details?.reason || 'unknown';

      if (isQuitting() || win.isDestroyed()) return;

      if (!ABNORMAL_REASONS.has(reason)) {
        logger.info(`${name} renderer exited (${reason}) — no auto-reload`);
        return;
      }

      const ts = now();
      while (crashTimes.length && ts - crashTimes[0] > RENDERER_CRASH_WINDOW_MS) {
        crashTimes.shift();
      }
      crashTimes.push(ts);

      if (crashTimes.length > MAX_RENDERER_RELOADS) {
        logger.error(`${name} renderer crashed ${crashTimes.length} times within ${RENDERER_CRASH_WINDOW_MS / 60000} min (last: ${reason}) — giving up auto-reload`);
        onGiveUp?.(details);
        return;
      }

      logger.warn(`${name} renderer gone (${reason}, exit code ${details?.exitCode}) — auto-reloading (${crashTimes.length}/${MAX_RENDERER_RELOADS})`);
      try {
        win.webContents.reload();
      } catch (err) {
        logger.error(`${name} auto-reload failed:`, err.message);
      }
    });
  }

  return {
    beginStartupProbation,
    scheduleStableMark,
    markStartupHealthy,
    forceSafeModeNextLaunch,
    attachRendererRecovery,
  };
}

module.exports = {
  createCrashGuard,
  SAFE_MODE_THRESHOLD,
  STARTUP_STABLE_MS,
  RENDERER_CRASH_WINDOW_MS,
  MAX_RENDERER_RELOADS,
};
