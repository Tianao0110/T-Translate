// Endpoint-volume compensation for system loopback (which taps after the
// system volume), free of native imports. Numbers: docs/design/listen.md §5.

const DEFAULT_CAP_DB = 40;
const DEFAULT_MARGIN_DB = 6;

function compensationGain(db, { capDb = DEFAULT_CAP_DB, marginDb = DEFAULT_MARGIN_DB } = {}) {
  if (!Number.isFinite(db) || db >= -marginDb) return 1;
  const gain = Math.pow(10, (-db - marginDb) / 20);
  return Math.min(gain, Math.pow(10, capDb / 20));
}

// Sticky guard against compensating a device that applies its volume in
// hardware: sustained clipping under gain trips it.
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

module.exports = { compensationGain, makeClipGuard, applyGain, };
