// One media stream at a time: WebM bytes → demuxer → WebCodecs → 16 kHz
// mono → feeder → companion ASR session. onEvent({ key, event }) carries the
// session's events (status, segment, translation, closed) and the feeder's
// (suspended, dropped, error); every open ends with exactly one 'closed'.

import { createWebmDemuxer } from './webm-demux.js';
import { createOpusDecoder, createResampler } from './decode.js';
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

const sameTrack = (a, b) =>
  a.codec === b.codec && a.channels === b.channels && a.sampleRate === b.sampleRate && String(a.codecPrivate) === String(b.codecPrivate);

export function createMediaPipeline({
  client,
  logger = console,
  onEvent = () => {},
  createDecoder = createOpusDecoder,
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
      logger.warn?.(`webm: ${evt.message}`);
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
    // A new key replaces the stream in progress (closed without draining).
    open({ key, lang = '', targetLang = '' } = {}) {
      if (typeof key !== 'string' || !key) throw new PipelineError('bad-request', 'key');
      const after = cur ? closeStream(cur, { drain: false }) : null;
      cur = {
        key,
        lang,
        targetLang,
        after,
        demuxer: createWebmDemuxer(),
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
        stats: { bytes: 0, blocks: 0, decodedS: 0, demuxErrors: 0, firstPushAt: 0, lastPcmAt: 0 },
      };
      return { key };
    },

    push({ key, bytes }) {
      const s = need(key);
      if (s.ended) return { ended: true };
      s.stats.firstPushAt ||= now();
      s.stats.bytes += bytes.length;
      for (const evt of s.demuxer.push(bytes)) onDemux(s, evt);
      return { ended: s.ended };
    },

    // Decodes and feeds what is left, closes the session; resolves the stats.
    close({ key } = {}) {
      if (last?.key === key && cur?.key !== key) return last.closing;
      return closeStream(need(key), { drain: true });
    },

    current: () => cur?.key ?? null,
  };
}
