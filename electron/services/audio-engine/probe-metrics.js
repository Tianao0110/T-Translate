// Pure helpers for the audio worker: log-record builders, repeat marking, the
// signal watchdog, AGC, VAD threshold policy, cut placement and the TTS gate.
// No Electron / native imports; tuning numbers: docs/design/listen.md §2–3.

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

// Levels ride along with the metrics so a stall can be explained afterwards.
function metricsRecord({ rssMb, cpuPct, audioInS, segments, rmsAvg, rmsMax, speechS, vadThreshold, endpointDb, agcGain }) {
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
  // Seconds the VAD reported speech in this window.
  if (speechS !== undefined) rec.speechS = round2(speechS);
  // Active VAD regime and the endpoint volume (system loopback only).
  if (vadThreshold !== undefined) rec.vadThreshold = vadThreshold;
  if (endpointDb !== undefined && endpointDb !== null) rec.endpointDb = round2(endpointDb);
  // Current AGC lift.
  if (agcGain !== undefined) rec.agcGain = round2(agcGain);
  return rec;
}

// Automatic gain ahead of the VAD: a boost-only envelope follower on 32 ms
// windows (fast attack, slow release, silence gate, cap).
function makeAgc({ target = 0.05, capDb = 30, gate = 0.0005, attack = 0.5, release = 0.02 } = {}) {
  const cap = Math.pow(10, capDb / 20);
  // Start assuming a quiet source so the first sentence is lifted at once.
  const initial = gate * 10;
  const initialGain = Math.min(cap, Math.max(1, target / initial));
  let env = initial;
  let gain = initialGain;
  return {
    // Scales `win` in place and returns it.
    process(win) {
      let s = 0;
      for (let i = 0; i < win.length; i++) s += win[i] * win[i];
      const rms = Math.sqrt(s / (win.length || 1));
      if (rms > gate) env += (rms - env) * (rms > env ? attack : release);
      gain = Math.min(cap, Math.max(1, target / Math.max(env, 1e-6)));
      if (gain !== 1) {
        for (let i = 0; i < win.length; i++) {
          const v = win[i] * gain;
          win[i] = v > 1 ? 1 : v < -1 ? -1 : v;
        }
      }
      return win;
    },
    gain() {
      return gain;
    },
    reset() {
      env = initial;
      gain = initialGain;
    },
  };
}

// VAD threshold by content (speech vs music), decided from SenseVoice's audio
// event tags. onFinal() returns the threshold to move to or null; the worker
// applies it only between segments.
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
    // Loud audio without finals: drop to the relaxed threshold and stay there.
    hold() {
      held = true;
      if (current === music) return null;
      current = music;
      return music;
    },
  };
}

// Where to put a forced cut: the quietest window inside the lookback tail,
// never inside the last `minTail` windows. Returns the index to cut AFTER, or
// -1 when there is too little to choose from.
function pickCutWindow(rmsList, { lookback = 47, minTail = 8 } = {}) {
  const n = rmsList.length;
  if (n <= minTail + 1) return -1;
  const from = Math.max(0, n - lookback);
  const to = n - 1 - minTail; // inclusive
  if (to < from) return -1;
  let best = from;
  for (let i = from + 1; i <= to; i++) if (rmsList[i] < rmsList[best]) best = i;
  return best;
}

// A final too short for a subtitle line (fragments the VAD closes on breaths
// over music). Speech finals are never filtered.
function isNegligibleFinal(text) {
  const bare = (text || '').replace(/[\s\p{P}]/gu, '');
  if (!bare) return true;
  const cjk = (bare.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
  if (cjk > 0) return bare.length <= 2;
  return bare.length <= 3; // Latin: a single short word or less
}

// Watches audio energy and recognition output; hint() says 'no-audio' (silent
// stream), 'no-speech' (sound but nothing recognized) or null. Time is
// injected for tests.
function makeSignalWatchdog({ silenceRms = 1e-5, noAudioAfterMs = 5000, noSpeechAfterMs = 12000 } = {}) {
  let lastLoudMs = null;
  let lastActivityMs = null; // a final landed, or the VAD had a segment open
  let startedMs = null;

  return {
    start(nowMs) {
      startedMs = nowMs;
      lastLoudMs = null;
      lastActivityMs = null;
    },
    onChunk(rms, nowMs) {
      if (rms > silenceRms) lastLoudMs = nowMs;
    },
    onSegment(nowMs) {
      lastActivityMs = nowMs;
    },
    // An open VAD segment counts as activity.
    onSpeech(nowMs) {
      lastActivityMs = nowMs;
    },
    // Returns 'no-audio' | 'no-speech' | null.
    hint(nowMs) {
      if (startedMs === null) return null;
      const sinceLoud = lastLoudMs === null ? nowMs - startedMs : nowMs - lastLoudMs;
      if (sinceLoud >= noAudioAfterMs) return 'no-audio';
      const sinceActivity = lastActivityMs === null ? nowMs - startedMs : nowMs - lastActivityMs;
      if (lastLoudMs !== null && sinceActivity >= noSpeechAfterMs) return 'no-speech';
      return null;
    },
  };
}

// Mute gate for the app's own TTS playback: blocked while on and for tailMs after.
function makeTtsGate({ tailMs = 300 } = {}) {
  let on = false;
  let offAt = -Infinity;
  return {
    set(next, nowMs) {
      if (on && !next) offAt = nowMs;
      on = !!next;
    },
    blocked(nowMs) {
      return on || nowMs - offAt < tailMs;
    },
    isOn() {
      return on;
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
  segmentRecord,
  eventRecord,
  metricsRecord,
  makeSignalWatchdog,
  makeVadThresholdPolicy,
  isNegligibleFinal,
  makeAgc,
  pickCutWindow,
  makeTtsGate,
};
