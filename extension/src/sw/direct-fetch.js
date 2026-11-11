// Service worker: a page's directly played MP4 (<video src="https://….mp4">,
// no MSE to copy from) fetched by HTTP range and fed to the offscreen media
// pipeline as a 'direct' stream. First the head (64 KB) for where the moov
// is, then the moov (from the head, or from where mdat ends), then the audio
// samples' bytes from fromS on, never more than aheadS seconds past the
// playhead that position() reports (fromS until it does); video bytes
// between audio chunks are skipped when the gap is large. One file at a
// time; a new open stops the last one's fetching.
//
// A request that gets no answer in requestTimeoutMs, or drops, is tried
// once more. A fetch that fails after open (not 206, 416, 403, network,
// timeout) stops the fetching but not the stream, which keeps what it has; it comes back as
// onEvent({ key, event: { type: 'error', code: 'fetch-failed', status } }),
// the shape of the pipeline's MEDIA_EVENT, so page-events handles both
// alike; the end of the file as { type: 'status', state: 'fetch-end' }.
// Requests carry Range and the page's cookies, nothing else, and skip the
// HTTP cache (each range is read once). The only permission check: the
// extension may read the file's host.

import { MSG, MAX_MEDIA_PUSH_BYTES, MessageError, encodeBytes } from '../shared/messages.js';
import { parseMoov, probeHead, indexAtTime, topBoxes } from '../shared/mp4-table.js';

const HEAD_BYTES = 64 * 1024;
const MAX_MOOV_BYTES = 32 * 1024 * 1024;
const GAP_BYTES = 64 * 1024;
const REFILL_S = 15; // once ahead, wait until the lead is this much short before fetching again
const REQUEST_TIMEOUT_MS = 30000; // one range, headers and body
const MAX_SESSIONS = 4;

const ABORTED = new MessageError('closed');

class FetchError extends MessageError {
  constructor(status, message = `HTTP ${status}`) {
    super('fetch-failed', message);
    this.status = status;
  }
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function contentRange(header) {
  const m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(String(header || '').trim());
  return m ? { start: Number(m[1]), end: Number(m[2]), total: m[3] === '*' ? null : Number(m[3]) } : null;
}

// The match pattern for a URL's host (patterns carry no port).
export function hostPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

export function createDirectFetch({
  fetchFn = (...a) => fetch(...a),
  toOffscreen,
  permissions = globalThis.chrome?.permissions,
  onEvent = () => {},
  now = () => Date.now(),
  logger = console,
  aheadS = 60,
  chunkBytes = 512 * 1024,
  gapBytes = GAP_BYTES,
  headBytes = HEAD_BYTES,
  maxMoovBytes = MAX_MOOV_BYTES,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  retries = 1,
} = {}) {
  const refillMs = Math.min(REFILL_S, aheadS / 4) * 1000;
  const sessions = new Map(); // key → session, the last few
  let cur = null;

  function emit(s, event) {
    try {
      onEvent({ key: s.key, event });
    } catch (e) {
      logger.warn?.(`direct event listener failed: ${e.message}`);
    }
  }

  // Stops fetching for good; the stream is left to close().
  function halt(s, reason) {
    if (s.halted) return;
    s.halted = true;
    s.reason ??= reason;
    s.ctl.abort();
    s.wake?.();
  }

  function check(s) {
    if (s.halted) throw ABORTED;
  }

  // Bytes [start, end) of the file; fewer at its end. A stalled or dropped
  // request is tried again; an HTTP answer is final.
  async function fetchRange(s, start, end) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchOnce(s, start, end);
      } catch (e) {
        if (!(e instanceof FetchError) || e.status !== 0 || attempt >= retries) throw e;
        s.retried++;
        logger.warn?.(`direct: range ${start}-${end - 1} ${e.message}, again`);
      }
    }
  }

  async function fetchOnce(s, start, end) {
    check(s);
    s.requests++;
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    s.ctl.signal.addEventListener('abort', stop);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, requestTimeoutMs);
    const lost = (e) => {
      check(s);
      return new FetchError(0, timedOut ? 'timeout' : e?.message || 'network');
    };
    try {
      let res;
      try {
        res = await fetchFn(s.url, { headers: { Range: `bytes=${start}-${end - 1}` }, credentials: 'include', redirect: 'follow', cache: 'no-store', signal: ctl.signal });
      } catch (e) {
        throw lost(e);
      }
      check(s);
      if (res.status !== 206) {
        res.body?.cancel?.().catch(() => {});
        throw new FetchError(res.status);
      }
      const range = contentRange(res.headers.get('content-range'));
      if (!range || range.start !== start) {
        res.body?.cancel?.().catch(() => {});
        throw new FetchError(206, 'bad content-range');
      }
      if (range.total !== null) s.total = range.total;
      let bytes;
      try {
        bytes = new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        throw lost(e);
      }
      s.bytes += bytes.length;
      return bytes.length > end - start ? bytes.subarray(0, end - start) : bytes;
    } finally {
      clearTimeout(timer);
      s.ctl.signal.removeEventListener('abort', stop);
    }
  }

  // The moov's sample table and the bytes that carry it to the pipeline: ftyp + moov from the head, or the moov alone from the tail.
  async function readMoov(s) {
    const head = await fetchRange(s, 0, headBytes);
    const probe = probeHead(head);
    let bytes;
    let at;
    if (probe.where === 'head') {
      if (probe.moov.size > maxMoovBytes) throw new MessageError('moov-too-large');
      const end = probe.moov.offset + probe.moov.size;
      bytes = end > head.length ? concat(head, await fetchRange(s, head.length, end)) : head.subarray(0, end);
      at = 0;
    } else if (probe.where === 'tail') {
      const from = probe.moovOffset;
      if (s.total !== null && from >= s.total) throw new MessageError('no-moov');
      let tail = await fetchRange(s, from, Math.min(from + headBytes, s.total ?? Infinity));
      const moov = topBoxes(tail).find((b) => b.type === 'moov');
      if (!moov) throw new MessageError('no-moov');
      if (moov.size > maxMoovBytes) throw new MessageError('moov-too-large');
      const end = moov.offset + moov.size;
      if (end > tail.length) tail = concat(tail, await fetchRange(s, from + tail.length, from + end));
      bytes = tail.subarray(moov.offset, end);
      at = from + moov.offset;
    } else throw new MessageError('no-moov');
    try {
      return { table: parseMoov(bytes, { base: at }), bytes, at, where: probe.where };
    } catch (e) {
      throw new MessageError(/sound|audio/.test(e.message) ? 'no-audio' : 'bad-moov', e.message);
    }
  }

  // False once the pipeline says the stream ended.
  async function push(s, bytes, offset) {
    for (let i = 0; i < bytes.length; i += MAX_MEDIA_PUSH_BYTES) {
      check(s);
      const r = await toOffscreen(MSG.MEDIA_PUSH, { key: s.key, bytes: encodeBytes(bytes.subarray(i, i + MAX_MEDIA_PUSH_BYTES)), offset: offset + i });
      s.pushes++;
      if (r?.ended) return false;
    }
    return true;
  }

  // Samples from i on that one request takes: before limitMs, within chunkBytes, no gap over gapBytes.
  function rangeFrom(samples, i, limitMs) {
    const start = samples[i].offset;
    let end = start + samples[i].size;
    let j = i + 1;
    for (; j < samples.length; j++) {
      const x = samples[j];
      if (x.timeMs >= limitMs || x.offset - end > gapBytes || x.offset + x.size - start > chunkBytes) break;
      end = Math.max(end, x.offset + x.size);
    }
    return { start, end, next: j };
  }

  const playOf = (s) => s.playS ?? s.fromS;
  const endOf = (s, j) => (j < s.table.samples.length ? s.table.samples[j].timeMs / 1000 : s.table.durationMs / 1000);

  async function pump(s) {
    const samples = s.table.samples;
    let filling = true;
    try {
      for (;;) {
        check(s);
        if (s.next >= samples.length) {
          s.done = true;
          emit(s, { type: 'status', state: 'fetch-end' });
          return;
        }
        const limitMs = (playOf(s) + aheadS) * 1000;
        const nextMs = samples[s.next].timeMs;
        if (nextMs >= limitMs || (!filling && nextMs >= limitMs - refillMs)) {
          filling = false;
          await new Promise((r) => (s.wake = r));
          s.wake = null;
          continue;
        }
        filling = true;
        const r = rangeFrom(samples, s.next, limitMs);
        const bytes = await fetchRange(s, r.start, r.end);
        if (!(await push(s, bytes, r.start))) {
          s.reason ??= 'pipeline-ended';
          return;
        }
        const got = r.start + bytes.length;
        let j = s.next;
        while (j < r.next && samples[j].offset + samples[j].size <= got) j++;
        if (j === s.next) throw new FetchError(206, 'short range');
        s.next = j;
        s.fetchedToS = endOf(s, j);
        s.maxAheadS = Math.max(s.maxAheadS, s.fetchedToS - playOf(s));
      }
    } catch (e) {
      if (e === ABORTED || s.halted) return;
      s.error = { code: e.code || 'error', status: e.status ?? null, message: String(e.message || '') };
      s.reason ??= e.code || 'error';
      if (e instanceof FetchError) emit(s, { type: 'error', code: 'fetch-failed', status: e.status });
      else logger.warn?.(`direct push: ${e.code || e.message}`);
    }
  }

  function statsOf(s) {
    const playS = playOf(s);
    return {
      url: s.url,
      fromS: s.fromS,
      playS,
      startS: s.startS,
      fetchedToS: s.fetchedToS,
      aheadS: s.fetchedToS === null ? null : Math.round((s.fetchedToS - playS) * 1000) / 1000,
      maxAheadS: Math.round(s.maxAheadS * 1000) / 1000,
      limitS: aheadS,
      bytes: s.bytes,
      requests: s.requests,
      retried: s.retried,
      pushes: s.pushes,
      moovAt: s.where,
      durationS: s.table ? s.table.durationMs / 1000 : null,
      done: s.done,
      error: s.error,
      reason: s.reason,
      startedAt: s.startedAt,
    };
  }

  async function open({ key, url, fromS = 0, lang = '', targetLang = '' } = {}) {
    if (typeof key !== 'string' || !key) throw new MessageError('bad-request', 'key');
    let pattern;
    try {
      if (!/^https?:$/.test(new URL(url).protocol)) throw new Error();
      pattern = hostPattern(url);
    } catch {
      throw new MessageError('bad-request', 'url');
    }
    if (permissions && !(await permissions.contains({ origins: [pattern] }))) throw new MessageError('no-permission', pattern);
    const s = {
      key,
      url,
      fromS: Number.isFinite(fromS) && fromS > 0 ? fromS : 0,
      ctl: new AbortController(),
      table: null,
      where: null,
      total: null,
      next: 0,
      playS: null,
      startS: null,
      fetchedToS: null,
      maxAheadS: 0,
      bytes: 0,
      requests: 0,
      retried: 0,
      pushes: 0,
      done: false,
      error: null,
      reason: null,
      halted: false,
      opened: false,
      wake: null,
      pumping: null,
      closing: null,
      startedAt: now(),
    };
    if (cur) halt(cur, 'replaced');
    cur = s;
    sessions.set(key, s);
    if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    try {
      const moov = await readMoov(s);
      check(s);
      s.table = moov.table;
      s.where = moov.where;
      await toOffscreen(MSG.MEDIA_OPEN, { key, lang, targetLang, source: 'direct' });
      s.opened = true;
      await push(s, moov.bytes, moov.at);
    } catch (e) {
      const halted = s.halted;
      s.error = { code: e.code || 'open-failed', status: e.status ?? null, message: String(e.message || '') };
      halt(s, e.code || 'open-failed');
      if (cur === s) cur = null;
      if (s.opened) toOffscreen(MSG.MEDIA_CLOSE, { key }).catch(() => {});
      throw halted ? ABORTED : e instanceof MessageError ? e : new MessageError(e.code || 'open-failed', e.message);
    }
    s.next = indexAtTime(s.table, s.fromS * 1000);
    s.startS = endOf(s, s.next);
    s.fetchedToS = s.startS;
    s.pumping = pump(s);
    const { track, samples } = s.table;
    return { key, url, fromS: s.fromS, startS: s.startS, durationS: s.table.durationMs / 1000, codec: track.codec, samples: samples.length, moovAt: s.where };
  }

  // Stops fetching (the request in flight is aborted), closes the stream
  // (the pipeline drains it unless drain is false, and with handover leaves
  // its session to the next stream); resolves the pipeline's stats plus { fetch }.
  function close({ key, drain = true, handover = false } = {}) {
    const s = sessions.get(key);
    if (!s) return Promise.resolve(null);
    s.closing ??= (async () => {
      halt(s, 'closed');
      if (cur === s) cur = null;
      await s.pumping;
      let stats = null;
      if (s.opened) stats = await toOffscreen(MSG.MEDIA_CLOSE, { key, drain: drain !== false, ...(handover === true && { handover: true }) }).catch((e) => ({ closeError: e.code || e.message }));
      return { ...stats, fetch: statsOf(s) };
    })();
    return s.closing;
  }

  return {
    open,
    close,
    // The playhead (media seconds) the lead is measured from.
    position(key, timeS) {
      const s = sessions.get(key);
      if (!s || s.halted || !Number.isFinite(timeS) || timeS < 0) return null;
      s.playS = timeS;
      s.wake?.();
      return statsOf(s);
    },
    stats: (key) => {
      const s = sessions.get(key);
      return s ? statsOf(s) : null;
    },
    current: () => (cur && !cur.halted ? cur.key : null),
  };
}
