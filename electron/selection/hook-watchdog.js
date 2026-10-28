// Re-installs the selection hook once Windows has dropped it: the cursor kept
// moving across checks but no mouse event arrived. controller.js starts and
// stops it with the hook and feeds it every mouse event.

const CHECK_INTERVAL_MS = 3000;
const SILENT_CHECKS = 2;
const MIN_RESTART_GAP_MS = 60 * 1000;

function createHookWatchdog({
  getCursor,
  restart,
  now = Date.now,
  timers = { setInterval, clearInterval },
  intervalMs = CHECK_INTERVAL_MS,
}) {
  let timer = null;
  let lastEventAt = 0;
  let lastCheckAt = 0;
  let lastCursor = null;
  let strikes = 0;
  let lastRestartAt = -Infinity;

  function noteEvent() {
    lastEventAt = now();
  }

  function check() {
    const cursor = getCursor();
    const t = now();
    const moved = !!lastCursor && (cursor.x !== lastCursor.x || cursor.y !== lastCursor.y);
    if (lastEventAt > lastCheckAt) strikes = 0;
    else if (moved) strikes += 1;
    lastCursor = cursor;
    lastCheckAt = t;

    if (strikes >= SILENT_CHECKS && t - lastRestartAt >= MIN_RESTART_GAP_MS) {
      strikes = 0;
      lastRestartAt = t;
      restart();
    }
  }

  function stop() {
    if (timer) timers.clearInterval(timer);
    timer = null;
  }

  function start() {
    stop();
    lastEventAt = now();
    lastCheckAt = lastEventAt;
    lastCursor = getCursor();
    strikes = 0;
    timer = timers.setInterval(check, intervalMs);
    timer?.unref?.();
  }

  return { start, stop, noteEvent };
}

module.exports = { createHookWatchdog, CHECK_INTERVAL_MS, SILENT_CHECKS, MIN_RESTART_GAP_MS };
