// The DRM fallback: a companion listen session (the app captures the system's
// sound itself), one at a time, its events carried under the caller's key
// exactly like the media pipeline's: status, segment, translation, closed.
// Every open that succeeded ends with exactly one 'closed'. A close for a
// seek leaves the app's session to the next open of the same languages
// (reason 'handover'), which takes it over with a seek; one nobody takes in
// leaseMs is closed.

import { createSessionRoute } from './session-route.js';

const CLOSE_WAIT_MS = 10000;
const LEASE_MS = 5000;

export class ListenError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

export function createListenSessions({ client, onEvent = () => {}, logger = console, closeWaitMs = CLOSE_WAIT_MS, leaseMs = LEASE_MS } = {}) {
  let cur = null;
  let last = null;
  let lease = null; // { id, route, lang, targetLang, dead, timer }
  const canSeek = () => client.getState?.()?.capabilities?.seek === true;

  function emit(s, event) {
    if (event.type === 'closed') {
      if (s.closedSent) return;
      s.closedSent = true;
      if (cur === s) cur = null;
      s.onClosed();
    }
    try {
      onEvent({ key: s.key, event });
    } catch (e) {
      logger.warn?.(`listen event listener failed: ${e.message}`);
    }
  }

  function session(key, id, lang, targetLang, route = null) {
    const s = { key, id, lang, targetLang, route, closedSent: false, closing: null, segments: 0, onClosed: () => {} };
    s.closed = new Promise((r) => {
      s.onClosed = r;
    });
    s.onEvent = (event) => {
      if (event.type === 'segment') s.segments++;
      emit(s, event);
    };
    return s;
  }

  // The app's session goes; its last events still reach the stream that had it.
  async function release(l) {
    clearTimeout(l.timer);
    if (lease === l) lease = null;
    try {
      await client.closeAsr(l.id);
    } catch (e) {
      logger.warn?.(`listen close failed: ${e.code || e.message}`);
    }
    let timer;
    Promise.race([l.route.closed, new Promise((r) => (timer = setTimeout(r, closeWaitMs)))]).then(() => {
      clearTimeout(timer);
      l.route.sub?.stop();
    });
  }

  function closeSession(s, { handover = false } = {}) {
    s.closing ??= (async () => {
      if (cur === s) cur = null;
      last = s;
      if (handover && !s.closedSent) {
        if (lease) await release(lease);
        const l = { id: s.id, route: s.route, lang: s.lang, targetLang: s.targetLang, dead: false, timer: null };
        l.timer = setTimeout(() => release(l), leaseMs);
        s.route.lease = l;
        lease = l;
        emit(s, { type: 'closed', reason: 'handover' });
        return { key: s.key, id: s.id, segments: s.segments, handedOver: true };
      }
      if (!s.closedSent) {
        try {
          await client.closeAsr(s.id);
        } catch (e) {
          logger.warn?.(`listen close failed: ${e.code || e.message}`);
        }
        let timer;
        await Promise.race([s.closed, new Promise((r) => (timer = setTimeout(r, closeWaitMs)))]);
        clearTimeout(timer);
      }
      s.route.sub?.stop();
      emit(s, { type: 'closed', reason: 'closed' });
      return { key: s.key, id: s.id, segments: s.segments };
    })();
    return s.closing;
  }

  // The lease, taken over from mediaStartS; null when there is none for
  // these languages or the seek failed (the app's session is closed then).
  async function adopt(key, lang, targetLang, mediaStartS) {
    const l = lease;
    if (!l) return null;
    clearTimeout(l.timer);
    lease = null;
    if (!l.dead && l.lang === lang && l.targetLang === targetLang) {
      try {
        await client.seekAsr(l.id, { mediaStartS });
        if (!l.dead) {
          const s = session(key, l.id, lang, targetLang, l.route);
          l.route.hand(s.onEvent);
          return s;
        }
      } catch (e) {
        logger.warn?.(`listen seek failed: ${e.code || e.message}`);
      }
    }
    await release(l);
    return null;
  }

  return {
    // Rejects with the client's error (busy, no-model, unreachable …).
    async open({ key, lang = '', targetLang = '', mediaStartS = 0 } = {}) {
      if (typeof key !== 'string' || !key) throw new ListenError('bad-request', 'key');
      const start = Math.max(0, Number(mediaStartS) || 0);
      // The app holds one companion session: the previous one must be gone (or leased) first.
      if (cur) await closeSession(cur, { handover: canSeek() && cur.lang === lang && cur.targetLang === targetLang });
      const taken = await adopt(key, lang, targetLang, start);
      if (taken) {
        cur = taken;
        return { key, id: taken.id, adopted: true };
      }
      const { id } = await client.listenOpen({ lang, targetLang, mediaStartS: start });
      const s = session(key, id, lang, targetLang);
      s.route = createSessionRoute(s.onEvent);
      cur = s;
      s.route.sub = client.subscribe(id, s.route.deliver);
      return { key, id };
    },

    // Resolves once the session is closed (or, with handover, leased); a
    // repeated close gets the same answer.
    close({ key, handover = false } = {}) {
      if (cur && cur.key === key) return closeSession(cur, { handover: handover === true && canSeek() });
      if (last && last.key === key) return last.closing;
      throw new ListenError('no-session', String(key));
    },

    current: () => cur?.key ?? null,
  };
}
