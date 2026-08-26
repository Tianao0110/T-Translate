// Crash guard: renderer auto-reload + consecutive-startup-failure safe mode.
//
// Two independent layers:
//   1. Startup probation — a dirty flag in electron-store. Set at launch,
//      cleared when the app either survives STARTUP_STABLE_MS or quits
//      normally. A flag still present at the next launch means the previous
//      one died before reaching stability (crash, force-kill, startup hang),
//      and the consecutive-failure counter advances. At SAFE_MODE_THRESHOLD
//      the caller boots into safe mode (no hardware acceleration, no native
//      module preheat). One healthy run resets everything.
//   2. Renderer recovery — render-process-gone on a window triggers an
//      automatic webContents.reload(), bounded by a sliding time window so a
//      renderer that crashes on its own startup path cannot reload-loop
//      forever; past the limit the per-window onGiveUp callback decides
//      (main window: relaunch into safe mode; floating window: close).
//
// Deliberately dependency-injected and free of require('electron'): CJS
// require('electron') gets externalized to the real npm package under vitest
// (the alias mock only covers ESM), so injection is what keeps this testable
// — same pattern as secure-vault.

const SAFE_MODE_THRESHOLD = 3;
const STARTUP_STABLE_MS = 60_000;
const RENDERER_CRASH_WINDOW_MS = 3 * 60_000;
const MAX_RENDERER_RELOADS = 3;

// Reasons that mean the renderer died on its own. 'clean-exit' is a normal
// teardown; 'killed' is the OS or the user (task manager, app.exit) — neither
// should trigger a reload.
const ABNORMAL_REASONS = new Set([
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
  'abnormal-exit',
]);

function createCrashGuard({ store, logger, now = Date.now }) {
  // Only the instance that won the single-instance lock runs probation. The
  // losing instance quits immediately — its before-quit must not wipe the
  // real counters, which this flag guarantees.
  let probationStarted = false;
  let stableTimer = null;

  // Called once at launch, after the single-instance lock. Returns the number
  // of consecutive failed launches BEFORE this one (including the one just
  // detected), so the caller can compare against SAFE_MODE_THRESHOLD.
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

  // Arm the stability timer: surviving STARTUP_STABLE_MS counts as a healthy
  // launch even if the app is later force-killed.
  function scheduleStableMark() {
    if (!probationStarted || stableTimer) return;
    stableTimer = setTimeout(() => markStartupHealthy('stable'), STARTUP_STABLE_MS);
    stableTimer.unref?.();
  }

  // Healthy launch: clear the dirty flag and the counter. Also the normal-quit
  // path — a user who starts the app and quits it on purpose within the
  // stability window did use it successfully.
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

  // The renderer kept crashing past the reload limit: pre-load the counter to
  // the threshold so the NEXT launch boots straight into safe mode. Pending
  // stays false — the relaunch itself must not add another failure on top.
  function forceSafeModeNextLaunch() {
    store.set('crashGuard.consecutiveStartupFailures', SAFE_MODE_THRESHOLD);
    store.set('crashGuard.startupPending', false);
  }

  // Attach auto-reload to a window. Abnormal renderer death reloads in place
  // (window stays hidden if it was hidden — no surprise popups); more than
  // MAX_RENDERER_RELOADS abnormal deaths inside RENDERER_CRASH_WINDOW_MS
  // calls onGiveUp instead. The window keeps its listener for its whole life,
  // so the sliding window is what separates "rare OOM once a day" (reload,
  // fine) from "crashes on arrival" (give up, escalate).
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
