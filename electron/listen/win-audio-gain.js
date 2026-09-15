// Endpoint-volume compensation for system loopback, kept free of native
// imports so it is unit-testable.
//
// Why: WASAPI loopback taps the mix AFTER the endpoint (system) volume. A
// user listening at 8% is at -38 dB, which turned a 0.35 rms song into 0.005
// and left silero deaf (38% of lyric lines detected vs 95% once undone —
// gstack v041-listen-music-diagnosis). Process loopback taps before that
// volume, which is why "just this program" worked and "all sound" did not.

// Capped so a slider parked at -60 dB does not turn the noise floor into a
// signal. The margin keeps the restored level under the original: the engine
// measured ~1.5 dB less attenuation than the endpoint reported, some players
// run ~2 dB hot, and a brick-walled master restored that much too hot would
// clip. 6 dB under is still far above anything the VAD needs (0.19 rms of a
// song scored the same lyric coverage as 0.31).
const DEFAULT_CAP_DB = 40;
const DEFAULT_MARGIN_DB = 6;

function compensationGain(db, { capDb = DEFAULT_CAP_DB, marginDb = DEFAULT_MARGIN_DB } = {}) {
  if (!Number.isFinite(db) || db >= -marginDb) return 1;
  const gain = Math.pow(10, (-db - marginDb) / 20);
  return Math.min(gain, Math.pow(10, capDb / 20));
}

// A device that applies its volume in hardware hands loopback a full-scale
// signal, and the inverse gain would only clip it. The endpoint's hardware
// support flags do not say which case you are in (a Realtek codec reports
// hardware volume and still attenuates in software), so the guard watches
// the outcome: sustained clipping under gain means the assumption is wrong.
function makeClipGuard({ windowSamples = 32000, maxRatio = 0.01, clipLevel = 0.999 } = {}) {
  let seen = 0;
  let clipped = 0;
  let tripped = false;
  return {
    // Feed post-gain samples; returns true once the guard has tripped (sticky).
    check(samples) {
      if (tripped) return true;
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i];
        if (v >= clipLevel || v <= -clipLevel) clipped += 1;
      }
      seen += samples.length;
      if (seen >= windowSamples) {
        if (clipped / seen > maxRatio) tripped = true;
        seen = 0;
        clipped = 0;
      }
      return tripped;
    },
    tripped() {
      return tripped;
    },
  };
}

function applyGain(samples, gain) {
  if (gain === 1) return samples;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] * gain;
    samples[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return samples;
}

module.exports = { compensationGain, makeClipGuard, applyGain, DEFAULT_CAP_DB, DEFAULT_MARGIN_DB };
