// Pure helpers for the ASR probe worker: log-record builders, repeat marking,
// silence/no-speech watchdog state. No Electron/native imports — unit-testable.

// Mark segments whose normalized text equals the previous one (whisper-style
// hallucination fingerprint). Record only, never filter.
function normalizeForRepeat(text) {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function makeRepeatTracker() {
  let prev = null;
  return function isRepeat(text) {
    const norm = normalizeForRepeat(text);
    if (!norm) return false;
    const repeated = norm === prev;
    prev = norm;
    return repeated;
  };
}

function segmentRecord({ segStartS, segDurS, decodeMs, lang, event, text, repeated }) {
  return {
    ts: Date.now(),
    type: 'segment',
    segStartS: round2(segStartS),
    segDurS: round2(segDurS),
    decodeMs: Math.round(decodeMs),
    rtf: segDurS > 0 ? round3(decodeMs / 1000 / segDurS) : null,
    lang: lang || '',
    event: event || '',
    textLen: (text || '').length,
    repeated: !!repeated,
    text: text || '',
  };
}

function eventRecord(kind, detail) {
  const rec = { ts: Date.now(), type: 'event', kind };
  if (detail !== undefined) rec.detail = detail;
  return rec;
}

// rmsAvg/rmsMax are the difference between "the stream went quiet" and "the
// VAD ignored perfectly audible audio". Without them a stall in the log is
// unexplainable: the no-audio watchdog only proves the signal was not exactly
// zero (its floor is 1e-5, far below anything audible).
function metricsRecord({ rssMb, cpuPct, audioInS, segments, rmsAvg, rmsMax, speechS, vadThreshold, endpointDb }) {
  const rec = {
    ts: Date.now(),
    type: 'metrics',
    rssMb: Math.round(rssMb),
    cpuPct: round2(cpuPct),
    audioInS: round2(audioInS),
    segments,
  };
  if (rmsAvg !== undefined) rec.rmsAvg = round3(rmsAvg);
  if (rmsMax !== undefined) rec.rmsMax = round3(rmsMax);
  // Seconds the VAD reported speech during this window — separates "nothing
  // was said" from "speech was detected but never got finalized".
  if (speechS !== undefined) rec.speechS = round2(speechS);
  // Which VAD regime was active, and how far the system volume was turned
  // down (system loopback only): a quiet rmsAvg next to endpointDb -38 says
  // "the user listens quietly", the same rmsAvg with 0 dB says "the source is".
  if (vadThreshold !== undefined) rec.vadThreshold = vadThreshold;
  if (endpointDb !== undefined && endpointDb !== null) rec.endpointDb = round2(endpointDb);
  return rec;
}

// VAD threshold by content. silero's 0.5 is right for speech, but sung vocals
// over a beat hover under it and whole lyric lines never open a segment:
// measured on a real song through process loopback, 86% of lyric lines at
// 0.5 and 100% at 0.3, with speech material unaffected (gstack
// v041-listen-music-diagnosis). SenseVoice tags every final with an audio
// event, so the content itself says which regime we are in. onFinal() returns
// the threshold to move to, or null to stay; the worker applies it only
// between segments. Two of the last three finals tagged BGM is enough to go
// down; it takes three speech finals in a row to come back up.
function makeVadThresholdPolicy({ speech = 0.5, music = 0.3, window = 3 } = {}) {
  const recent = [];
  let current = speech;
  let held = false;
  return {
    current() {
      return current;
    },
    onFinal(event) {
      recent.push(event === '<|BGM|>' ? 'music' : 'speech');
      if (recent.length > window) recent.shift();
      if (held || recent.length < window) return null;
      const musicCount = recent.filter((x) => x === 'music').length;
      let next = current;
      if (current === speech && musicCount >= 2) next = music;
      else if (current === music && musicCount === 0) next = speech;
      if (next === current) return null;
      current = next;
      return next;
    },
    // The watchdog saw loud audio with no finals for a long stretch: whatever
    // the content is, 0.5 is not opening on it. Drop to the relaxed threshold
    // and stay there for the rest of the session — a policy that climbed back
    // on the next three speech finals would just go deaf again 12s later.
    hold() {
      held = true;
      if (current === music) return null;
      current = music;
      return music;
    },
  };
}

// A final that is not worth a subtitle line: over music the VAD closes on
// breaths and yields one- or two-character fragments ("如。") that flash on
// screen and burn a translation call. Speech finals are never filtered.
function isNegligibleFinal(text) {
  const bare = (text || '').replace(/[\s\p{P}]/gu, '');
  if (!bare) return true;
  const cjk = (bare.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
  if (cjk > 0) return bare.length <= 2;
  return bare.length <= 3; // Latin: a single short word or less
}

// Watches incoming audio energy and recognition output, and decides which
// hint ('no-audio' when the stream is silent, 'no-speech' when there is sound
// but nothing ever gets recognized) should fire. Time is injected for tests.
// noSpeechAfterMs 12s (was 30s): probe logs showed a real 21s stretch where
// audio kept arriving and the VAD produced nothing, and at 30s the user got no
// word about it at all — the screen just stopped. 12s is past any normal
// sentence gap (segments are force-split at 9s) so it does not fire mid-speech.
function makeSignalWatchdog({ silenceRms = 1e-5, noAudioAfterMs = 5000, noSpeechAfterMs = 12000 } = {}) {
  let lastLoudMs = null;
  let lastSegmentMs = null;
  let startedMs = null;

  return {
    start(nowMs) {
      startedMs = nowMs;
      lastLoudMs = null;
      lastSegmentMs = null;
    },
    onChunk(rms, nowMs) {
      if (rms > silenceRms) lastLoudMs = nowMs;
    },
    onSegment(nowMs) {
      lastSegmentMs = nowMs;
    },
    // Returns 'no-audio' | 'no-speech' | null.
    hint(nowMs) {
      if (startedMs === null) return null;
      const sinceLoud = lastLoudMs === null ? nowMs - startedMs : nowMs - lastLoudMs;
      if (sinceLoud >= noAudioAfterMs) return 'no-audio';
      const sinceSegment = lastSegmentMs === null ? nowMs - startedMs : nowMs - lastSegmentMs;
      if (lastLoudMs !== null && sinceSegment >= noSpeechAfterMs) return 'no-speech';
      return null;
    },
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = {
  makeRepeatTracker,
  normalizeForRepeat,
  segmentRecord,
  eventRecord,
  metricsRecord,
  makeSignalWatchdog,
  makeVadThresholdPolicy,
  isNegligibleFinal,
};
