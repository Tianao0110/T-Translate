// The metrics sink for the T-Engine event stream (docs/T-ENGINE.md §7):
// one JSON line per event in data\logs\tengine-<date>.jsonl, the last few
// days kept, and a ring of recent events for the status page. Secure mode
// writes nothing to disk — the ring is all there is. Whatever an event
// carries, text never lands here: known content keys are dropped and long
// strings are cut, so a mistake upstream stays a number.

const nodeFs = require('fs');
const nodePath = require('path');

const KEEP_FILES = 3;
const RING_SIZE = 200;
const MAX_STRING = 200;
const CONTENT_KEYS = new Set(['text', 'prompt', 'system', 'user', 'input', 'output', 'messages', 'image', 'audio', 'samples', 'transcript']);

function scrub(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth > 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (CONTENT_KEYS.has(k)) continue;
    const s = scrub(v, depth + 1);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

function dayStamp(now) {
  return new Date(now()).toISOString().slice(0, 10);
}

function createMetricsLog({ dir, keep = KEEP_FILES, ring = RING_SIZE, now = Date.now, isSecure = () => false, fs = nodeFs, path = nodePath, logger = null } = {}) {
  const recent = [];
  let currentDay = null;
  let currentPath = null;
  let ready = false;

  function prepare() {
    const day = dayStamp(now);
    if (ready && day === currentDay) return currentPath;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const old = fs
        .readdirSync(dir)
        .filter((f) => /^tengine-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        .sort();
      const mine = `tengine-${day}.jsonl`;
      const others = old.filter((f) => f !== mine);
      while (others.length >= keep) fs.unlinkSync(path.join(dir, others.shift()));
      currentDay = day;
      currentPath = path.join(dir, mine);
      ready = true;
    } catch (e) {
      logger?.warn?.(`metrics log unavailable: ${e.message}`);
      ready = false;
      currentPath = null;
    }
    return currentPath;
  }

  function write(event) {
    const record = scrub({ ...event });
    if (!record.at) record.at = now();
    recent.push(record);
    if (recent.length > ring) recent.shift();
    if (isSecure()) return false;
    const file = prepare();
    if (!file) return false;
    try {
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
      return true;
    } catch (e) {
      logger?.warn?.(`metrics log write failed: ${e.message}`);
      return false;
    }
  }

  return {
    write,
    recent: (n = ring) => recent.slice(-n),
    path: () => (isSecure() ? null : prepare()),
  };
}

module.exports = { createMetricsLog, scrub };
