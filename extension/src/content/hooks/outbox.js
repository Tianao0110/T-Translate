// Page world: everything the hooks report goes through here. Until the
// isolated world's hello brings a port, events wait in order within bounds:
// subtitle responses (newest LIMITS.subtitleQueue), init segments (all, up to
// LIMITS.initQueue), media chunks (a ring of LIMITS.ringBytes, oldest out)
// and small events (newest LIMITS.eventQueue). After it, each event goes out
// at once with the hello's nonce, media bytes transferred, not copied.

import { LIMITS, TC_EVENT, TC_HELLO, TC_COMMAND } from '../bridge-protocol.js';

const classOf = (ev) => (ev.k === 'mse-chunk' ? (ev.init ? 'init' : 'chunk') : ev.k === 'subtitle' ? 'subtitle' : 'event');
const sizeOf = (ev) => (ev.bytes instanceof ArrayBuffer ? ev.bytes.byteLength : ev.k === 'subtitle' ? ev.text.length : 0);

export function createOutbox({ limits = LIMITS } = {}) {
  let port = null;
  let nonce = null;
  let queue = [];
  const held = { chunk: 0, init: 0, subtitle: 0, event: 0, ringBytes: 0 };
  const dropped = { chunks: 0, bytes: 0, subtitles: 0, events: 0 };

  function post(ev) {
    try {
      port.postMessage({ tc: TC_EVENT, nonce, ev }, ev.bytes instanceof ArrayBuffer ? [ev.bytes] : []);
    } catch {}
  }

  function dropOldest(cls) {
    const i = queue.findIndex((e) => e.cls === cls);
    if (i < 0) return false;
    const [e] = queue.splice(i, 1);
    held[cls]--;
    if (cls === 'chunk') {
      held.ringBytes -= e.size;
      dropped.chunks++;
      dropped.bytes += e.size;
    } else if (cls === 'subtitle') dropped.subtitles++;
    else dropped.events++;
    return true;
  }

  return {
    push(ev) {
      if (port) return post(ev);
      const cls = classOf(ev);
      const size = sizeOf(ev);
      queue.push({ ev, cls, size });
      held[cls]++;
      if (cls === 'chunk') held.ringBytes += size;
      while (held.ringBytes > limits.ringBytes && dropOldest('chunk'));
      while (held.subtitle > limits.subtitleQueue && dropOldest('subtitle'));
      while (held.event > limits.eventQueue && dropOldest('event'));
      while (held.init > limits.initQueue && dropOldest('init'));
    },

    // Takes the first port only. Flushes in arrival order.
    connect(p, n) {
      if (port || !p || typeof n !== 'string') return false;
      port = p;
      nonce = n;
      post({ k: 'welcome' });
      if (dropped.chunks || dropped.subtitles || dropped.events) post({ k: 'dropped', ...dropped });
      for (const e of queue) post(e.ev);
      queue = [];
      return true;
    },

    get connected() {
      return !!port;
    },
    get nonce() {
      return nonce;
    },
    held: () => ({ ...held, queued: queue.length }),
    dropped: () => ({ ...dropped }),
  };
}

// Waits for the isolated world's hello (the first one wins; it is hidden from
// the page's own message listeners), then runs onCommand for every command
// that carries the nonce. Replies go back through the outbox.
export function acceptHello(win, outbox, onCommand) {
  const onMessage = (e) => {
    const d = e.data;
    if (e.source !== win || !d || d.tc !== TC_HELLO || typeof d.nonce !== 'string' || !e.ports || !e.ports[0]) return;
    e.stopImmediatePropagation();
    const p = e.ports[0];
    if (!outbox.connect(p, d.nonce)) return;
    win.removeEventListener('message', onMessage, true);
    p.onmessage = (m) => {
      const c = m.data;
      if (!c || c.tc !== TC_COMMAND || c.nonce !== d.nonce || !Number.isSafeInteger(c.id) || typeof c.cmd !== 'string') return;
      Promise.resolve()
        .then(() => onCommand(c.cmd, c.args))
        .then(
          (result) => outbox.push({ k: 'reply', id: c.id, ok: true, result: result ?? null }),
          (err) => outbox.push({ k: 'reply', id: c.id, ok: false, error: String(err?.code || err?.message || err).slice(0, 200) })
        );
    };
  };
  win.addEventListener('message', onMessage, true);
  return () => win.removeEventListener('message', onMessage, true);
}
