// Companion Protocol v1 as the extension sees it: the port range the app
// listens on, request headers, stream rules and pure helpers. The server side
// is electron/companion/protocol.js; rules live in docs/design/listen.md §11.

export const PROTOCOL_VERSION = 1;
export const CLIENT_NAME = 't-caption';
export const HOST = '127.0.0.1';
export const PORT_BASE = 38423;
export const PORT_SPAN = 10;
export const SAMPLE_RATE = 16000;
// One feed post per second of audio.
export const FEED_CHUNK_SAMPLES = SAMPLE_RATE;
export const MAX_TRANSLATE_ITEMS = 50;
export const MAX_TRANSLATE_CHARS = 2000;
// The server writes a '{}' heartbeat every 15 s; three missed ones is a dead stream.
export const STREAM_SILENCE_MS = 45000;

export const CLIENT_STATUS = {
  UNPAIRED: 'unpaired',
  OFFLINE: 'offline',
  READY: 'ready',
};

// The preferred port first, then the whole range in order.
export function portRange(preferred = null) {
  const ports = [];
  if (Number.isInteger(preferred) && preferred > 0) ports.push(preferred);
  for (let i = 0; i < PORT_SPAN; i++) {
    const p = PORT_BASE + i;
    if (p !== preferred) ports.push(p);
  }
  return ports;
}

export function baseUrl(port) {
  return `http://${HOST}:${port}`;
}

// NDJSON: feed text as it arrives, get back whole non-blank lines.
export function createLineSplitter() {
  let buffer = '';
  return {
    push(text) {
      buffer += text;
      const parts = buffer.split('\n');
      buffer = parts.pop();
      return parts.map((l) => l.trim()).filter(Boolean);
    },
    flush() {
      const rest = buffer.trim();
      buffer = '';
      return rest ? [rest] : [];
    },
  };
}

// Reconnect delay: 1 s, 2 s, 4 s … capped at 30 s.
export function backoffMs(attempt) {
  return Math.min(30000, 1000 * 2 ** Math.max(0, Math.min(attempt, 5)));
}

// Splits translate items into server-sized batches, keeping order.
export function batches(items, size = MAX_TRANSLATE_ITEMS) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
