// 16 kHz mono PCM → one feed() per second of audio on a companion ASR
// session, in order, honouring the server's backpressure; the session's
// events go to onEvent unchanged, plus 'suspended', 'dropped' and 'error'.
// The desktop side keeps the media timeline from mediaStartS and the samples fed.
// At a seek the session is not closed: detach() leases it to the next
// feeder, whose start() takes it over with a seek (session-route.js).

import { FEED_CHUNK_SAMPLES, SAMPLE_RATE } from '../shared/protocol.js';
import { createSessionRoute } from './session-route.js';

const STALL_MS = 60000;
const MAX_QUEUE_S = 90;
const CLOSE_WAIT_MS = 10000;
const RETRY_UNREACHABLE_MS = 1000;
// Session gone on the server: its event stream says why.
const GONE = new Set(['unknown-session', 'unauthorized', 'unpaired']);

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createAudioFeeder({
  client,
  lang = '',
  targetLang = '',
  mediaStartS = 0,
  onEvent = () => {},
  logger = console,
  sleep = defaultSleep,
  now = Date.now,
  stallMs = STALL_MS,
  maxQueueS = MAX_QUEUE_S,
  closeWaitMs = CLOSE_WAIT_MS,
  lease = null, // a detached feeder's lease, or a promise of one / null
} = {}) {
  const maxChunks = Math.max(1, Math.round((maxQueueS * SAMPLE_RATE) / FEED_CHUNK_SAMPLES));
  // idle → starting → running ⇄ suspended → draining → closing → closed;
  // failed on errors; detached once the session went to the next feeder
  let state = 'idle';
  let id = null;
  let route = null;
  let starting = null;
  let stopping = null;
  let detaching = null;
  let pumping = null;
  let wake = null; // ends a backpressure wait early (detach)
  let handedOver = false;
  let adopted = false;
  const queue = []; // full chunks not yet sent
  let tail = new Float32Array(FEED_CHUNK_SAMPLES);
  let tailLen = 0;
  let seq = 0;
  let lastSegmentAt = 0;
  let sawClosed = false;
  let onClosed = () => {};
  const closed = new Promise((r) => {
    onClosed = r;
  });
  const stats = { fedChunks: 0, waits: 0, waitReasons: {}, droppedS: 0, firstFeedAt: 0, lastFeedAt: 0 };

  const emit = (evt) => {
    try {
      onEvent(evt);
    } catch (e) {
      logger.warn?.(`feeder event listener failed: ${e.message}`);
    }
  };

  function onServerEvent(evt) {
    if (evt.type === 'segment') lastSegmentAt = now();
    if (evt.type === 'closed') {
      sawClosed = true;
      if (state !== 'closing') state = 'closed';
      queue.length = 0;
      onClosed();
    }
    emit(evt);
  }

  function fail(e) {
    if (GONE.has(e.code)) {
      if (state !== 'closing' && state !== 'closed') state = 'closed';
      return;
    }
    state = 'failed';
    queue.length = 0;
    logger.warn?.(`feed failed: ${e.code || e.message}`);
    emit({ type: 'error', code: e.code || 'feed-failed' });
  }

  const pumpable = () => state === 'running' || state === 'draining';

  function nap(ms) {
    if (state === 'detached') return Promise.resolve();
    return new Promise((resolve) => {
      wake = resolve;
      sleep(ms).then(resolve);
    }).finally(() => (wake = null));
  }

  function kick() {
    if (pumping || !pumpable() || !queue.length) return;
    pumping = pump().finally(() => {
      pumping = null;
      kick();
    });
  }

  async function pump() {
    let waitingSince = 0;
    while (pumpable() && queue.length) {
      const chunk = queue.shift();
      const n = seq++;
      for (;;) {
        let r;
        try {
          r = await client.feed(id, chunk, n);
        } catch (e) {
          if (e.code) return fail(e);
          r = { wait: RETRY_UNREACHABLE_MS, reason: 'unreachable' }; // the app may be restarting
        }
        if (r.ok) {
          stats.fedChunks++;
          stats.lastFeedAt = now();
          stats.firstFeedAt ||= stats.lastFeedAt;
          waitingSince = 0;
          break;
        }
        stats.waits++;
        stats.waitReasons[r.reason] = (stats.waitReasons[r.reason] || 0) + 1;
        const t = now();
        waitingSince ||= t;
        if (t - Math.max(waitingSince, lastSegmentAt) >= stallMs) {
          queue.unshift(chunk);
          seq = n;
          state = 'suspended';
          emit({ type: 'suspended' });
          return;
        }
        await nap(r.wait);
        if (!pumpable()) {
          if (state === 'suspended') {
            queue.unshift(chunk);
            seq = n;
          }
          return;
        }
      }
    }
  }

  // Keeps the newest maxQueueS of audio waiting.
  function trim() {
    const over = queue.length - maxChunks;
    if (over <= 0) return;
    queue.splice(0, over);
    const seconds = (over * FEED_CHUNK_SAMPLES) / SAMPLE_RATE;
    stats.droppedS += seconds;
    emit({ type: 'dropped', seconds });
  }

  function snapshot() {
    return {
      id,
      state,
      fedChunks: stats.fedChunks,
      fedS: (stats.fedChunks * FEED_CHUNK_SAMPLES) / SAMPLE_RATE,
      waits: stats.waits,
      waitReasons: { ...stats.waitReasons },
      droppedS: stats.droppedS,
      feedMs: stats.lastFeedAt - stats.firstFeedAt,
      queuedS: (queue.length * FEED_CHUNK_SAMPLES + tailLen) / SAMPLE_RATE,
      closed: sawClosed,
      handedOver,
      adopted,
    };
  }

  // The session for the next feeder: adopt(onEvent) moves its events there
  // and returns the route (its sub to stop); release() closes it instead,
  // its last events still coming here until 'closed'.
  function leaseOf() {
    const r = route;
    let released = false;
    const l = {
      id,
      seq,
      lang,
      targetLang,
      dead: false,
      taken: false,
      adopt(handler) {
        l.taken = true;
        r.hand(handler);
        return r;
      },
      async release() {
        if (released || l.taken) return;
        released = true;
        r.lease = null;
        try {
          await client.closeAsr(l.id);
        } catch (e) {
          logger.warn?.(`close failed: ${e.code || e.message}`);
        }
        let timer;
        Promise.race([r.closed, new Promise((res) => (timer = setTimeout(res, closeWaitMs)))]).then(() => {
          clearTimeout(timer);
          r.sub?.stop();
        });
      },
    };
    r.lease = l;
    return l;
  }

  // Takes over a detached feeder's session with a seek; any failure releases
  // it. True when taken.
  async function adopt(held) {
    if (!held.dead) {
      try {
        await client.seekAsr(held.id, { mediaStartS });
        if (held.dead) throw Object.assign(new Error('closed'), { code: 'closed' });
        ({ id, seq } = held);
        route = held.adopt(onServerEvent);
        adopted = true;
        return true;
      } catch (e) {
        logger.warn?.(`seek failed: ${e.code || e.message}`);
      }
    }
    await held.release();
    return false;
  }

  return {
    // Takes over the leased session, else opens one and its event stream.
    // Rejects with the client's error (busy, no-model, unpaired …), or
    // 'stopped' when stop() came first.
    start() {
      if (!starting && state !== 'idle') return Promise.reject(Object.assign(new Error('stopped'), { code: 'stopped' }));
      starting ??= (async () => {
        state = 'starting';
        const held = await lease;
        if (!(held && (await adopt(held)))) {
          try {
            ({ id } = await client.openAsr({ mode: 'feed', lang, targetLang, mediaStartS }));
          } catch (e) {
            state = 'failed';
            throw e;
          }
          route = createSessionRoute(onServerEvent);
          route.sub = client.subscribe(id, route.deliver);
        }
        if (state === 'starting') state = 'running';
        kick();
        return id;
      })();
      return starting;
    },

    // Queues PCM (16 kHz mono); sending starts once the session is open. False once stopped.
    push(pcm) {
      if (!['idle', 'starting', 'running', 'suspended'].includes(state)) return false;
      for (let i = 0; i < pcm.length; ) {
        const n = Math.min(pcm.length - i, FEED_CHUNK_SAMPLES - tailLen);
        tail.set(pcm.subarray(i, i + n), tailLen);
        tailLen += n;
        i += n;
        if (tailLen === FEED_CHUNK_SAMPLES) {
          queue.push(tail);
          tail = new Float32Array(FEED_CHUNK_SAMPLES);
          tailLen = 0;
        }
      }
      trim();
      kick();
      return true;
    },

    resume() {
      if (state !== 'suspended') return;
      state = 'running';
      kick();
    },

    // Sends the zero-padded tail and what is queued (drain), closes the
    // session and waits for its 'closed'. Resolves the stats.
    stop({ drain = true } = {}) {
      stopping ??= (async () => {
        if (detaching && (await detaching)) return snapshot();
        try {
          await starting;
        } catch {}
        if (!id) {
          state = 'closed';
          return snapshot();
        }
        if (state === 'running' || state === 'suspended') {
          if (tailLen) {
            queue.push(tail); // the rest of the chunk is still zeros
            tail = new Float32Array(FEED_CHUNK_SAMPLES);
            tailLen = 0;
          }
          if (drain && state === 'running') {
            state = 'draining';
            kick();
            while (pumping) await pumping;
          }
        }
        queue.length = 0;
        const gone = state === 'closed';
        state = 'closing';
        if (!sawClosed) {
          if (!gone) {
            try {
              await client.closeAsr(id);
            } catch (e) {
              logger.warn?.(`close failed: ${e.code || e.message}`);
            }
          }
          let timer;
          await Promise.race([closed, new Promise((r) => (timer = setTimeout(r, closeWaitMs)))]);
          clearTimeout(timer);
        }
        route?.sub?.stop();
        state = 'closed';
        return snapshot();
      })();
      return stopping;
    },

    // A seek: the session goes to the next feeder instead of closing. What
    // is queued is dropped; the chunk already on its way lands first, so the
    // next feeder's seek comes after it. Resolves the lease, or null with no
    // session to hand over (then stop() closes as usual).
    detach() {
      if (stopping) return stopping.then(() => null);
      detaching ??= (async () => {
        try {
          await starting;
        } catch {}
        if (!id || (state !== 'running' && state !== 'suspended')) return null;
        queue.length = 0;
        tail = new Float32Array(FEED_CHUNK_SAMPLES);
        tailLen = 0;
        state = 'detached';
        wake?.();
        while (pumping) await pumping;
        if (sawClosed) return null;
        handedOver = true;
        return leaseOf();
      })();
      return detaching;
    },

    stats: snapshot,
    get state() {
      return state;
    },
  };
}
