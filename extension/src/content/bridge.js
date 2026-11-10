// Isolated world end of the bridge: hands the page world a MessageChannel
// port with a fresh nonce (again after a while if no welcome came back: the
// page world may not have been listening yet), then takes only messages on
// that port with that nonce, each one sanitized. command() runs a page-world
// action and resolves its reply.

import { TC_HELLO, TC_EVENT, TC_COMMAND, sanitizeMainEvent } from './bridge-protocol.js';

const RETRY_MS = [100, 500, 2000, 5000];

const randomNonce = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export function createBridge({ win = window, onEvent, makeChannel = () => new MessageChannel(), nonce = randomNonce, retryMs = RETRY_MS, onConnect = () => {} }) {
  let port = null;
  let portNonce = null;
  const attempts = [];
  const pending = new Map();
  const timers = [];
  let nextId = 0;
  let rejected = 0;

  function receive(p, n, m) {
    if (!m || m.tc !== TC_EVENT || m.nonce !== n) return;
    if (!port) {
      port = p;
      portNonce = n;
      for (const a of attempts) if (a !== p) a.close();
      timers.forEach(clearTimeout);
      onConnect();
    }
    if (p !== port) return;
    const ev = sanitizeMainEvent(m.ev);
    if (!ev) {
      rejected++;
      return;
    }
    if (ev.k === 'welcome') return;
    if (ev.k === 'reply') {
      const w = pending.get(ev.id);
      if (!w) return;
      pending.delete(ev.id);
      clearTimeout(w.timer);
      if (ev.ok) w.resolve(ev.result ?? null);
      else w.reject(Object.assign(new Error(ev.error || 'page-world-error'), { code: ev.error || 'page-world-error' }));
      return;
    }
    onEvent(ev);
  }

  function hello() {
    if (port) return;
    const ch = makeChannel();
    const n = nonce();
    ch.port1.onmessage = (e) => receive(ch.port1, n, e.data);
    attempts.push(ch.port1);
    win.postMessage({ tc: TC_HELLO, nonce: n }, '*', [ch.port2]);
  }

  hello();
  for (const ms of retryMs) timers.push(setTimeout(hello, ms));

  return {
    get connected() {
      return !!port;
    },
    get rejected() {
      return rejected;
    },
    command(cmd, args = {}, timeoutMs = 15000) {
      if (!port) return Promise.reject(Object.assign(new Error('page world not connected'), { code: 'no-page-world' }));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Object.assign(new Error(cmd), { code: 'page-world-timeout' }));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        port.postMessage({ tc: TC_COMMAND, nonce: portNonce, id, cmd, args });
      });
    },
    close() {
      timers.forEach(clearTimeout);
      for (const a of attempts) a.close();
      for (const w of pending.values()) clearTimeout(w.timer);
      pending.clear();
    },
  };
}
