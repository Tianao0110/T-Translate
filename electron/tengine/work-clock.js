// Whether an engine is doing something for someone right now: the jobs it has
// open, plus a short tail after the last one so a quick job still shows on a
// settings page that reads status() about once a second.

const SETTLE_MS = 1500;

function createWorkClock({ now = Date.now, settleMs = SETTLE_MS } = {}) {
  const open = new Set();
  let lastEnd = -Infinity;
  let seq = 0;
  return {
    // A job started; returns its key (or takes one the caller already has).
    begin(key = `w${++seq}`) {
      open.add(key);
      return key;
    },
    end(key) {
      if (open.delete(key)) lastEnd = now();
    },
    // Runs fn as one job.
    async track(fn) {
      const key = this.begin();
      try {
        return await fn();
      } finally {
        this.end(key);
      }
    },
    working: () => open.size > 0 || now() - lastEnd < settleMs,
    clear() {
      if (open.size) lastEnd = now();
      open.clear();
    },
  };
}

module.exports = { createWorkClock, SETTLE_MS };
