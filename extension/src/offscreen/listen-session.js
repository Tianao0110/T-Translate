// The DRM fallback: a companion listen session (the app captures the system's
// sound itself), one at a time, its events carried under the caller's key
// exactly like the media pipeline's: status, segment, translation, closed.
// Every open that succeeded ends with exactly one 'closed'.

const CLOSE_WAIT_MS = 10000;

export class ListenError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

export function createListenSessions({ client, onEvent = () => {}, logger = console, closeWaitMs = CLOSE_WAIT_MS } = {}) {
  let cur = null;
  let last = null;

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

  function closeSession(s) {
    s.closing ??= (async () => {
      if (cur === s) cur = null;
      last = s;
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
      s.sub?.stop();
      emit(s, { type: 'closed', reason: 'closed' });
      return { key: s.key, id: s.id, segments: s.segments };
    })();
    return s.closing;
  }

  return {
    // Rejects with the client's error (busy, no-model, unreachable …).
    async open({ key, lang = '', targetLang = '', mediaStartS = 0 } = {}) {
      if (typeof key !== 'string' || !key) throw new ListenError('bad-request', 'key');
      // The app holds one companion session: the previous one must be gone first.
      if (cur) await closeSession(cur);
      const { id } = await client.listenOpen({ lang, targetLang, mediaStartS: Math.max(0, Number(mediaStartS) || 0) });
      const s = { key, id, sub: null, closedSent: false, closing: null, segments: 0, onClosed: () => {} };
      s.closed = new Promise((r) => {
        s.onClosed = r;
      });
      cur = s;
      s.sub = client.subscribe(id, (event) => {
        if (event.type === 'segment') s.segments++;
        emit(s, event);
      });
      return { key, id };
    },

    // Resolves once the session is closed; a repeated close gets the same answer.
    close({ key } = {}) {
      if (cur && cur.key === key) return closeSession(cur);
      if (last && last.key === key) return last.closing;
      throw new ListenError('no-session', String(key));
    },

    current: () => cur?.key ?? null,
  };
}
