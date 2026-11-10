// One companion listen session at a time, on audio-engine-manager's sink:
// engine callbacks become an ordered event queue for the client, and fed
// audio is metered against the finals. Rules: docs/design/listen.md §11.

const crypto = require('crypto');
const { MAX_AHEAD_S, createFeedBudget, mediaTimeOf } = require('./protocol');

const MAX_BACKLOG = 500;
// A session nobody reads or feeds is closed after this long.
const IDLE_CLOSE_MS = 30000;
// After the engine stopped, how long 'closed' waits for translations still
// in flight (the translator itself gives them 3 s, listen-translator.js).
const SETTLE_MS = 3500;
const TERMINAL = new Set(['stopped', 'model-load-failed', 'engine-dead', 'no-model']);
const NOT_READY = new Set(['loading', 'connecting', 'engine-restarting']);
const LANG_RE = /^[A-Za-z0-9-]{0,16}$/;
// The engine's stop reasons as the client sees them.
const CLOSE_REASONS = { 'companion-close': 'closed', 'companion-idle': 'idle', 'companion-disabled': 'disabled' };

const cleanLang = (tag) => (typeof tag === 'string' ? tag.replace(/[<|>]/g, '') : '');

function closeReason(state, detail) {
  if (state !== 'stopped') return state;
  if (typeof detail === 'string' && detail) return CLOSE_REASONS[detail] || detail;
  return null;
}

function createCompanionSession({ engineManager, logger, now = Date.now, maxAheadS = MAX_AHEAD_S, maxBacklog = MAX_BACKLOG, idleCloseMs = IDLE_CLOSE_MS, settleMs = SETTLE_MS, onChange = () => {} }) {
  let current = null;
  // The session that closed last, so a late events subscriber still gets its end.
  let last = null;

  const ownerNow = () => engineManager.currentOwner();

  function find(id) {
    if (current && current.id === id) return current;
    if (last && last.id === id) return last;
    return null;
  }

  function emit(s, evt) {
    if (!s.listeners.size) {
      s.backlog.push(evt);
      if (s.backlog.length > maxBacklog) s.backlog.shift();
      return;
    }
    for (const fn of [...s.listeners]) {
      try {
        fn(evt);
      } catch (e) {
        logger?.warn?.(`companion listener failed: ${e.message}`);
      }
    }
  }

  function armIdle(s) {
    clearTimeout(s.idleTimer);
    s.idleTimer = null;
    if (s.closed || s.listeners.size || !idleCloseMs) return;
    s.idleTimer = setTimeout(() => {
      s.idleTimer = null;
      if (s.closed || s.listeners.size) return;
      logger?.info?.('companion session idle with no reader — closing');
      stop(s, 'companion-idle');
    }, idleCloseMs);
    s.idleTimer.unref?.();
  }

  function stop(s, reason) {
    if (s.closed) return;
    s.stopping = true;
    if (ownerNow() === 'companion') engineManager.stopSession(reason);
  }

  // A restarted worker counts its clock from zero again.
  function rebase(s) {
    if (s.mode === 'feed') s.clockS = s.budget.fedS();
    else if (s.listeningAt) s.clockS += (now() - s.listeningAt) / 1000;
    s.listeningAt = 0;
  }

  // 'closed' goes out once the translations still pending have settled (or
  // settleMs passed); the engine keeps delivering them to this sink meanwhile.
  function settleThenClose(s) {
    const deadline = now() + settleMs;
    const tick = () => {
      if (s.pendingIds.size && now() < deadline) {
        const t = setTimeout(tick, 100);
        t.unref?.();
        return;
      }
      logger?.info?.(`companion session closed (${s.closedReason})`);
      s.closedEvt = { type: 'closed', reason: s.closedReason };
      emit(s, s.closedEvt);
      onChange();
    };
    tick();
  }

  function finish(s, state, detail) {
    s.closed = true;
    s.ready = false;
    clearTimeout(s.idleTimer);
    if (current === s) {
      current = null;
      last = s;
    }
    const known = closeReason(state, detail);
    // Without a reason on 'stopped': by the next microtask a window start
    // queued behind this session owns the engine.
    queueMicrotask(() => {
      s.closedReason = known || (ownerNow() === 'window' ? 'preempted' : state);
      settleThenClose(s);
    });
  }

  function onStatus(s, state, detail) {
    if (state === 'metrics' || s.closed) return;
    s.state = state;
    if (state === 'listening') {
      s.ready = true;
      if (!s.listeningAt) s.listeningAt = now();
    } else if (NOT_READY.has(state)) {
      s.ready = false;
    }
    if (state === 'engine-restarting') rebase(s);
    emit(s, typeof detail === 'string' && detail ? { type: 'status', state, detail } : { type: 'status', state });
    if (TERMINAL.has(state)) finish(s, state, detail);
    else onChange();
  }

  function onSegment(s, rec) {
    if (s.closed || !rec) return;
    const t = mediaTimeOf(rec, s.mediaStartS + s.clockS);
    s.budget.finalAt(s.clockS + rec.segStartS + rec.segDurS);
    emit(s, { type: 'segment', id: rec.id, start: t.start, end: t.end, text: rec.text, lang: cleanLang(rec.lang) });
  }

  // Translations keep arriving after the engine stopped until 'closed' went out.
  function onTranslation(s, p) {
    if (s.closedEvt || !p) return;
    if (p.done) s.pendingIds.delete(p.id);
    else if (p.text === 'pending') s.pendingIds.add(p.id);
    emit(s, { type: 'translation', id: p.id, text: p.text, done: !!p.done });
  }

  // mode 'feed': the client posts PCM; 'system': the worker captures the
  // system's sound itself (DRM fallback). Returns { id } or { error }.
  function open({ mode, lang = '', targetLang = '', mediaStartS = 0 } = {}) {
    if (mode !== 'feed' && mode !== 'system') return { error: 'bad-request' };
    if (typeof lang !== 'string' || !LANG_RE.test(lang)) return { error: 'bad-request' };
    if (typeof targetLang !== 'string' || !LANG_RE.test(targetLang)) return { error: 'bad-request' };
    if (typeof mediaStartS !== 'number' || !Number.isFinite(mediaStartS) || mediaStartS < 0) return { error: 'bad-request' };
    // A session already told to close frees the slot (a seek reopens at once);
    // the engine queues the new start behind the worker going away.
    if (current && !current.stopping) return { error: 'busy', owner: 'companion' };

    const s = {
      id: crypto.randomUUID(),
      mode,
      state: 'starting',
      ready: false,
      mediaStartS,
      clockS: 0,
      listeningAt: 0,
      budget: createFeedBudget({ maxAheadS }),
      backlog: [],
      listeners: new Set(),
      closed: false,
      closedEvt: null,
      closedReason: null,
      pendingIds: new Set(),
      idleTimer: null,
    };
    if (current && current !== s) last = current; // the one still stopping
    current = s;
    const sink = {
      status: (state, detail) => onStatus(s, state, detail),
      segment: (rec) => onSegment(s, rec),
      translation: (p) => onTranslation(s, p),
    };
    let res;
    try {
      res = engineManager.startSession({
        owner: 'companion',
        sink,
        language: lang,
        targetLang,
        source: { mode: mode === 'feed' ? 'off' : 'system' },
      });
    } catch (e) {
      logger?.error?.(`companion session start failed: ${e.message}`);
      res = { ok: false, error: 'internal' };
    }
    if (!res || !res.ok) {
      s.closed = true;
      if (current === s) current = null;
      if (res?.busy) return { error: 'busy', owner: res.busy };
      return { error: res?.error || 'internal' };
    }
    logger?.info?.(`companion session opened (${mode})`);
    armIdle(s);
    onChange();
    return { id: s.id };
  }

  function feed(id, samples) {
    const s = current && current.id === id ? current : null;
    if (!s) return { error: 'unknown-session' };
    if (s.mode !== 'feed') return { error: 'wrong-mode' };
    if (!s.ready) return { error: 'not-ready' };
    if (!s.budget.canAccept(samples.length)) return { error: 'backpressure', retryAfterMs: 1000 };
    engineManager.feedPcm(samples);
    s.budget.fed(samples.length);
    armIdle(s);
    return { ok: true };
  }

  // Closing a session that already ended is not an error.
  function close(id) {
    if (current && current.id === id) {
      stop(current, 'companion-close');
      return { ok: true };
    }
    return find(id) ? { ok: true } : { error: 'unknown-session' };
  }

  function closeActive(reason = 'companion-close') {
    if (current) stop(current, reason);
  }

  // Replays the backlog in order, then delivers live events. Returns the
  // unsubscribe function, or null for an unknown id.
  function subscribe(id, onEvent) {
    const s = find(id);
    if (!s) return null;
    clearTimeout(s.idleTimer);
    s.idleTimer = null;
    s.listeners.add(onEvent);
    const backlog = s.backlog;
    s.backlog = [];
    if (s.closedEvt && !backlog.includes(s.closedEvt)) backlog.push(s.closedEvt);
    for (const evt of backlog) {
      try {
        onEvent(evt);
      } catch (e) {
        logger?.warn?.(`companion listener failed: ${e.message}`);
      }
    }
    return () => {
      if (s.listeners.delete(onEvent) && !s.listeners.size) armIdle(s);
    };
  }

  function status() {
    const s = current;
    if (!s) return { active: false, id: null, mode: null, state: null, aheadS: 0 };
    return { active: true, id: s.id, mode: s.mode, state: s.state, aheadS: s.budget.aheadS() };
  }

  return { open, feed, close, closeActive, subscribe, has: (id) => !!find(id), status };
}

module.exports = { createCompanionSession, LANG_RE };
