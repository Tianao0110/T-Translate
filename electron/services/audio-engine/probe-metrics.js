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

function metricsRecord({ rssMb, cpuPct, audioInS, segments }) {
  return {
    ts: Date.now(),
    type: 'metrics',
    rssMb: Math.round(rssMb),
    cpuPct: round2(cpuPct),
    audioInS: round2(audioInS),
    segments,
  };
}

// Watches incoming audio energy and recognition output, and decides which
// hint ('no-audio' when the stream is silent, 'no-speech' when there is sound
// but nothing ever gets recognized) should fire. Time is injected for tests.
function makeSignalWatchdog({ silenceRms = 1e-5, noAudioAfterMs = 5000, noSpeechAfterMs = 30000 } = {}) {
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
};
