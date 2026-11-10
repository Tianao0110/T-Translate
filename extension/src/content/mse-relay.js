// Isolated world: the page's MSE streams as the page world reports them.
// Every SourceBuffer is a stream (its id is the page world's sbId) with
// counts and media times (WebM clusters, MP4 fragments). Audio the pipeline
// can decode is held in a ring (LIMITS.ringBytes, oldest out, the init
// segment governing the oldest kept chunk is kept too) until
// start(streamId); then the ring and everything
// after it goes to send() as PAGE_MEDIA payloads: at most maxPush raw bytes,
// at least once a second, an init segment in a payload of its own, one in
// flight at a time. stop() drops what is queued and held.

import { LIMITS, classifyMime } from './bridge-protocol.js';
import { clusterTimes, timecodeScale, DEFAULT_TIMECODE_SCALE } from './webm-sniff.js';
import { fragmentTimes, mp4Timescale } from './mp4-sniff.js';
import { MAX_MEDIA_PUSH_BYTES, encodeBytes } from '../shared/messages.js';

const err = (code) => Object.assign(new Error(code), { code });
const MAX_SOURCES = 64;
const MAX_STREAMS = 32;

// Per container: the init segment's time scale (WebM ns per tick, MP4 ticks
// per second) and the { first, last } seconds of an append.
const SNIFF = {
  webm: { scale: timecodeScale, times: (u8, scale) => clusterTimes(u8, scale ?? DEFAULT_TIMECODE_SCALE) },
  mp4: { scale: mp4Timescale, times: (u8, scale) => (scale ? fragmentTimes(u8, scale) : null) },
};

function concat(parts, n) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function createMseRelay({
  send,
  onStream = () => {},
  onCaptureEnd = () => {},
  limits = LIMITS,
  maxPush = MAX_MEDIA_PUSH_BYTES,
  batchMs = 1000,
  now = () => Date.now(),
}) {
  const sources = new Map(); // msId → blob URL
  const streams = new Map(); // sbId → stream
  let capture = null;

  const summary = (s) => ({
    streamId: s.sbId,
    msId: s.msId,
    url: sources.get(s.msId) ?? null,
    mime: s.mime,
    kind: s.kind,
    codec: s.codec,
    forward: s.forward,
    alive: s.alive,
    init: s.inits > 0,
    inits: s.inits,
    chunks: s.chunks,
    bytes: s.bytes,
    firstTimeS: s.firstTimeS,
    lastTimeS: s.lastTimeS,
    lastOp: s.lastOp,
    held: s.ringBytes,
  });

  function addStream({ sbId, msId, mime }) {
    if (streams.size >= MAX_STREAMS) {
      const oldest = [...streams.values()].find((s) => !s.alive) || streams.values().next().value;
      streams.delete(oldest.sbId);
    }
    const s = { sbId, msId, mime, ...classifyMime(mime), alive: true, inits: 0, chunks: 0, bytes: 0, firstTimeS: null, lastTimeS: null, lastOp: null, scale: null, ring: [], ringBytes: 0, headInit: null, lastInit: null };
    streams.set(sbId, s);
    return s;
  }

  function kill(s) {
    s.alive = false;
    s.ring = [];
    s.ringBytes = 0;
    if (capture?.streamId === s.sbId) end('stream-gone');
  }

  function hold(s, entry) {
    s.ring.push(entry);
    s.ringBytes += entry.bytes.length;
    while (s.ringBytes > limits.ringBytes && s.ring.length > 1) {
      const e = s.ring.shift();
      s.ringBytes -= e.bytes.length;
      if (e.init) s.headInit = e;
    }
  }

  function onChunk(ev) {
    const s = streams.get(ev.sbId);
    if (!s) return null;
    s.chunks++;
    s.bytes += ev.size;
    if (ev.init) s.inits++;
    const u8 = ev.bytes ? new Uint8Array(ev.bytes) : null;
    let times = null;
    const sniff = SNIFF[s.container];
    if (u8 && sniff) {
      if (ev.init) s.scale = sniff.scale(u8) || s.scale;
      times = sniff.times(u8, s.scale);
      if (times) {
        s.firstTimeS ??= times.first;
        s.lastTimeS = times.last;
      }
    }
    if (u8 && s.forward && s.alive) {
      const entry = { init: ev.init, bytes: u8, timeS: times?.first ?? null, at: now() };
      if (ev.init) s.lastInit = entry;
      if (capture?.streamId === s.sbId) enqueue(entry);
      else hold(s, entry);
    }
    return s;
  }

  function enqueue(entry) {
    const c = capture;
    c.queue.push(entry);
    c.queueBytes += entry.bytes.length;
    if (c.queueBytes > limits.ringBytes) return end('overflow');
    pump();
  }

  // Next payload off the front of the queue: up to maxPush bytes; an init
  // segment travels alone.
  function take(c) {
    const parts = [];
    let n = 0;
    let init = false;
    let timeS = null;
    while (c.queue.length && n < maxPush) {
      const e = c.queue[0];
      if (parts.length && (e.init || init)) break;
      if (!parts.length) init = e.init;
      timeS ??= e.timeS;
      const room = maxPush - n;
      if (e.bytes.length <= room) {
        parts.push(e.bytes);
        n += e.bytes.length;
        c.queue.shift();
      } else {
        parts.push(e.bytes.subarray(0, room));
        n += room;
        c.queue[0] = { ...e, init: false, timeS: null, bytes: e.bytes.subarray(room) };
      }
    }
    c.queueBytes -= n;
    return { init, timeS, bytes: concat(parts, n), n };
  }

  function pump() {
    const c = capture;
    if (!c || c.sending || !c.queue.length) return;
    const age = now() - c.queue[0].at;
    const due = c.backlog > 0 || c.queueBytes >= maxPush || age >= batchMs || c.queue.slice(1).some((e) => e.init);
    if (!due) {
      if (!c.timer) {
        c.timer = setTimeout(() => {
          c.timer = null;
          pump();
        }, Math.max(0, batchMs - age));
      }
      return;
    }
    const batch = take(c);
    c.backlog = Math.max(0, c.backlog - batch.n);
    c.sending = true;
    const payload = { streamId: c.streamId, seq: c.seq++, init: batch.init, timeS: batch.timeS, bytes: encodeBytes(batch.bytes) };
    Promise.resolve()
      .then(() => send(payload))
      .then(
      (reply) => {
        c.sending = false;
        if (capture !== c) return;
        c.pushes++;
        c.bytes += batch.n;
        const r = reply?.ok ? reply.result : null;
        if (!r?.accepted) return end(r?.reason || reply?.error?.code || 'refused');
        if (r.ended) return end('pipeline-ended');
        pump();
      },
      () => {
        c.sending = false;
        if (capture === c) end('send-failed');
      }
    );
  }

  function stop(reason = 'off') {
    const c = capture;
    if (!c) return null;
    capture = null;
    clearTimeout(c.timer);
    const s = streams.get(c.streamId);
    if (s) {
      s.ring = [];
      s.ringBytes = 0;
      s.headInit = s.lastInit;
    }
    return { streamId: c.streamId, pushes: c.pushes, bytes: c.bytes, reason };
  }

  function end(reason) {
    const r = stop(reason);
    if (r) onCaptureEnd(r);
  }

  return {
    // Returns the stream an event touched (for reporting), or null.
    onMainEvent(ev) {
      switch (ev.k) {
        case 'mse-source':
          if (sources.size >= MAX_SOURCES) sources.delete(sources.keys().next().value);
          sources.set(ev.msId, ev.url);
          for (const s of streams.values()) if (s.msId === ev.msId) onStream(summary(s));
          return null;
        case 'mse-buffer': {
          const s = addStream(ev);
          onStream(summary(s));
          return s;
        }
        case 'mse-chunk':
          return onChunk(ev);
        case 'mse-op': {
          const s = streams.get(ev.sbId);
          if (!s) return null;
          s.lastOp = { op: ev.op, at: now(), ...(ev.mime !== undefined && { mime: ev.mime }), ...(ev.start !== undefined && { start: ev.start, end: ev.end }), ...(ev.value !== undefined && { value: ev.value }) };
          if (ev.op === 'changeType') {
            const next = classifyMime(ev.mime ?? s.mime);
            if (next.container !== s.container) s.scale = null;
            Object.assign(s, { mime: ev.mime ?? s.mime }, next);
          }
          if (ev.op === 'removed') kill(s);
          onStream(summary(s));
          return s;
        }
        case 'mse-closed':
          for (const s of streams.values()) {
            if (s.msId === ev.msId && s.alive) {
              kill(s);
              onStream(summary(s));
            }
          }
          return null;
        default:
          return null;
      }
    },

    // fromS: held chunks with a media time before it are not sent (the init
    // segment that governs the first kept chunk still is).
    start(streamId, { fromS = null } = {}) {
      const s = streams.get(streamId);
      if (!s || !s.alive) throw err('no-stream');
      if (!s.forward) throw err('unsupported');
      stop('restart');
      let ring = s.ring;
      let governing = ring.length ? (ring[0].init ? null : s.headInit) : s.lastInit;
      if (Number.isFinite(fromS) && ring.length) {
        let i = 0;
        let gov = governing;
        for (; i < ring.length; i++) {
          const e = ring[i];
          if (e.init) gov = e;
          else if (!(e.timeS !== null && e.timeS < fromS)) break;
        }
        ring = ring.slice(i);
        governing = ring.length ? (ring[0].init ? null : gov) : s.lastInit;
      }
      const queue = [];
      if (governing) queue.push(governing);
      queue.push(...ring);
      s.ring = [];
      s.ringBytes = 0;
      s.headInit = s.lastInit;
      const queueBytes = queue.reduce((n, e) => n + e.bytes.length, 0);
      const init = !!queue[0]?.init;
      capture = { streamId, seq: 0, queue, queueBytes, backlog: queueBytes, sending: false, timer: null, pushes: 0, bytes: 0 };
      pump();
      return { streamId, backlogBytes: queueBytes, init };
    },

    stop,

    // The audio stream feeding the media element whose src is src: the
    // decodable one if there are several, else the latest audio stream.
    mainStream(src) {
      const audio = [...streams.values()].filter((s) => s.alive && s.kind === 'audio');
      const attached = src ? audio.filter((s) => sources.get(s.msId) === src) : [];
      const pool = attached.length ? attached : audio;
      const s = pool.filter((x) => x.forward).at(-1) || pool.at(-1);
      return s ? s.sbId : null;
    },

    // Forgets streams whose MediaSource is attached to none of the given srcs.
    keepAttached(srcs) {
      for (const s of [...streams.values()]) {
        const url = sources.get(s.msId);
        if (url && !srcs.has(url)) {
          if (capture?.streamId === s.sbId) stop('navigated');
          streams.delete(s.sbId);
        }
      }
    },

    msIdOf(src) {
      for (const [msId, url] of sources) if (url === src) return msId;
      return null;
    },
    streams: () => [...streams.values()].map(summary),
    stream: (id) => (streams.has(id) ? summary(streams.get(id)) : null),
    capture: () => (capture ? { streamId: capture.streamId, pushes: capture.pushes, bytes: capture.bytes, queued: capture.queueBytes } : null),
  };
}
