// One media stream at a time: WebM or fragmented MP4 bytes from a page's MSE
// (source 'mse'), or a progressive MP4 the service worker fetches by range
// (source 'direct', every push with its file offset) → demuxer →
// WebCodecs → 16 kHz mono → feeder → companion ASR session. onEvent({ key, event }) carries the
// session's events (status, segment, translation, closed) and the feeder's
// (suspended, dropped, error); every open ends with exactly one 'closed'.

import { createWebmDemuxer } from './webm-demux.js';
import { createMp4Demuxer } from './mp4-demux.js';
import { createProgressiveMp4Demuxer } from './mp4-progressive.js';
import { createAudioDecoder, createResampler } from './decode.js';
import { createAudioFeeder } from './audio-feeder.js';
import { SAMPLE_RATE } from '../shared/protocol.js';

// About a minute of 20 ms packets waiting for the decoder to configure.
const MAX_PENDING_BLOCKS = 3000;

export class PipelineError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

const SOURCES = ['mse', 'direct'];
const MP4_HEAD = new Set(['ftyp', 'moov', 'moof', 'styp', 'sidx']);

// 'webm' or 'mp4' from a stream's first 12 bytes (an init segment, or a
// cluster / fragment when the stream had none); WebM when unsure, as before.
export function containerOf(head) {
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
  const type = String.fromCharCode(head[4], head[5], head[6], head[7]);
  return MP4_HEAD.has(type) ? 'mp4' : 'webm';
}

// Holds the first 12 bytes, then hands everything to the demuxer they call for.
function createAutoDemuxer(onPick) {
  let inner = null;
  let head = new Uint8Array(0);
  const pick = () => {
    const container = containerOf(head);
    inner = container === 'mp4' ? createMp4Demuxer() : createWebmDemuxer();
    onPick(container);
    return inner.push(head);
  };
  return {
    push(bytes) {
      if (inner) return inner.push(bytes);
      const next = new Uint8Array(head.length + bytes.length);
      next.set(head);
      next.set(bytes, head.length);
      head = next;
      return head.length >= 12 ? pick() : [];
    },
    flush() {
      if (!inner && head.length) pick();
      return inner ? inner.flush() : [];
    },
  };
}

const sameTrack = (a, b) =>
  a.codec === b.codec && a.channels === b.channels && a.sampleRate === b.sampleRate && String(a.codecPrivate) === String(b.codecPrivate);

export function createMediaPipeline({
  client,
  logger = console,
  onEvent = () => {},
  createDecoder = createAudioDecoder,
  createFeeder = createAudioFeeder,
  now = () => performance.now(),
} = {}) {
  let cur = null;

  function emit(s, event) {
    if (event.type === 'closed') {
      if (s.closedSent) return;
      s.closedSent = true;
    }
    try {
      onEvent({ key: s.key, event });
    } catch (e) {
      logger.warn?.(`media event listener failed: ${e.message}`);
    }
  }

  // Stops decoding for good, reporting why once.
  function end(s, event, reason) {
    if (s.ended) return;
    s.ended = true;
    s.failure = reason;
    s.pending = [];
    emit(s, event);
  }

  function onPcm(s, { pcm, sampleRate }) {
    if (s.ended) return;
    s.stats.decodedS += pcm.length / sampleRate;
    s.stats.lastPcmAt = now();
    if (s.resamplerRate !== sampleRate) {
      s.resampler = createResampler(sampleRate, SAMPLE_RATE);
      s.resamplerRate = sampleRate;
    }
    const out = s.resampler.push(pcm);
    if (!s.feeder) {
      s.feeder = createFeeder({
        client,
        lang: s.lang,
        targetLang: s.targetLang,
        mediaStartS: Math.max(0, s.firstBlockMs / 1000),
        logger,
        onEvent: (event) => {
          if (event.type === 'closed') s.ended = true;
          emit(s, event);
        },
      });
      // The previous stream's session has to be gone before the app takes a new one.
      Promise.resolve(s.after)
        .then(() => s.feeder.start())
        .catch((e) => {
          const code = e.code || 'open-failed';
          logger.warn?.(`asr open failed: ${code}`);
          end(s, { type: 'error', code }, code);
        });
    }
    s.feeder.push(out);
  }

  const decodeFailed = (s, e) => {
    const code = e?.code || 'decode-failed';
    logger.warn?.(`decode: ${e?.message || code}`);
    end(s, { type: 'error', code }, code);
  };

  function decode(s, block) {
    if (s.firstBlockMs === null) s.firstBlockMs = block.timeMs;
    s.stats.blocks++;
    if (!s.decoder.decode(block)) decodeFailed(s);
  }

  // A new decoder for track; blocks wait in s.pending until it is configured.
  function useTrack(s, track) {
    const prev = s.decoder;
    s.track = track;
    s.decoder = null;
    s.decoderReady = (async () => {
      if (prev) {
        await prev.flush().catch(() => {});
        prev.close();
      }
      return createDecoder({ track, onPcm: (p) => onPcm(s, p), onError: (e) => decodeFailed(s, e) });
    })().then(
      (decoder) => {
        if (s.ended || s.track !== track) return decoder.close();
        s.decoder = decoder;
        const pending = s.pending;
        s.pending = [];
        for (const b of pending) if (!s.ended) decode(s, b);
      },
      (e) => {
        if (e.code === 'unsupported') end(s, { type: 'status', state: 'unsupported', codec: track.codec }, 'unsupported');
        else decodeFailed(s, e);
      }
    );
  }

  function onDemux(s, evt) {
    if (evt.type === 'track') {
      // The first audio track is ours; a new init segment may change its config.
      if (!s.track || (evt.number === s.track.number && !sameTrack(evt, s.track))) useTrack(s, evt);
      return;
    }
    if (evt.type === 'block') {
      if (!s.track || evt.track !== s.track.number || s.ended) return;
      if (s.decoder) return decode(s, evt);
      if (s.pending.length < MAX_PENDING_BLOCKS) s.pending.push(evt);
      return;
    }
    if (evt.type === 'error') {
      s.stats.demuxErrors++;
      logger.warn?.(`${s.stats.container}: ${evt.message}`);
    }
  }

  function need(key) {
    if (!cur || cur.key !== key) throw new PipelineError('no-stream', String(key));
    return cur;
  }

  let last = null; // the stream most recently closed, so a repeated close gets the same answer

  function closeStream(s, { drain }) {
    s.closing ??= (async () => {
      if (cur === s) cur = null;
      last = s;
      if (!s.ended) for (const evt of s.demuxer.flush()) onDemux(s, evt);
      if (drain && !s.ended) {
        await s.decoderReady;
        await s.decoder?.flush().catch(() => {});
      }
      s.decoder?.close();
      s.ended = true;
      const feeder = s.feeder ? await s.feeder.stop({ drain }) : null;
      // Covers streams that never opened a session, and an app that went quiet.
      emit(s, { type: 'closed', reason: s.failure || (feeder ? 'no-reply' : 'no-audio') });
      const { firstPushAt, lastPcmAt, ...rest } = s.stats;
      return { ...rest, decodeMs: lastPcmAt ? Math.round(lastPcmAt - firstPushAt) : 0, feeder };
    })();
    return s.closing;
  }

  return {
    // A new key replaces the stream in progress (closed without draining);
    // one still draining after close() is waited for (the app takes one
    // session at a time).
    open({ key, lang = '', targetLang = '', source = 'mse' } = {}) {
      if (typeof key !== 'string' || !key) throw new PipelineError('bad-request', 'key');
      if (!SOURCES.includes(source)) throw new PipelineError('bad-request', 'source');
      const after = cur ? closeStream(cur, { drain: false }) : (last?.closing ?? null);
      const s = {
        key,
        lang,
        targetLang,
        source,
        after,
        demuxer: null,
        track: null,
        decoder: null,
        decoderReady: null,
        pending: [],
        resampler: null,
        resamplerRate: 0,
        feeder: null,
        firstBlockMs: null,
        ended: false,
        failure: null,
        closedSent: false,
        closing: null,
        stats: { source, container: null, bytes: 0, blocks: 0, decodedS: 0, demuxErrors: 0, firstPushAt: 0, lastPcmAt: 0 },
      };
      if (source === 'direct') {
        s.demuxer = createProgressiveMp4Demuxer();
        s.stats.container = 'mp4';
      } else s.demuxer = createAutoDemuxer((container) => (s.stats.container = container));
      cur = s;
      return { key };
    },

    // offset: the bytes' file offset, required for a direct stream.
    push({ key, bytes, offset }) {
      const s = need(key);
      const direct = s.source === 'direct';
      if (direct && !(Number.isSafeInteger(offset) && offset >= 0)) throw new PipelineError('bad-request', 'offset');
      if (s.ended) return { ended: true };
      s.stats.firstPushAt ||= now();
      s.stats.bytes += bytes.length;
      for (const evt of direct ? s.demuxer.push(bytes, { offset }) : s.demuxer.push(bytes)) onDemux(s, evt);
      return { ended: s.ended };
    },

    // Decodes and feeds what is left (drain false: drops it, for a seek),
    // closes the session; resolves the stats.
    close({ key, drain = true } = {}) {
      if (last?.key === key && cur?.key !== key) return last.closing;
      return closeStream(need(key), { drain: drain !== false });
    },

    current: () => cur?.key ?? null,
  };
}
