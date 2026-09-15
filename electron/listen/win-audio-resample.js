// Downmix + integer-factor decimation for the process-loopback path, kept
// free of native imports so it is unit-testable.
//
// Why: process loopback accepts 16 kHz mono directly, but the audio engine's
// own conversion gave silero a measurably harder signal than a proper decode
// of the same source (86% of lyric lines at threshold 0.5 vs 95% —
// gstack v041-listen-music-diagnosis). Asking for the engine's native 48 kHz
// stereo and converting here with a windowed-sinc lowpass keeps that step
// under our control. 48k → 16k is an exact 3:1, so this is plain FIR
// decimation: one dot product per OUTPUT sample, ~1M multiplies/s.

function designLowpass(taps, cutoffCyclesPerSample) {
  const h = new Float32Array(taps);
  const mid = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * cutoffCyclesPerSample : Math.sin(2 * Math.PI * cutoffCyclesPerSample * x) / (Math.PI * x);
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
    h[i] = sinc * hamming;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum; // unity DC gain
  return h;
}

/**
 * @param {object} opts
 * @param {number} [opts.channels=2]  interleaved input channels
 * @param {number} [opts.factor=3]    inRate / outRate, must be an integer
 * @param {number} [opts.taps=63]     FIR length (odd)
 * @returns {{ process(interleaved: Float32Array): Float32Array, reset(): void }}
 */
function makeDownmixDecimator({ channels = 2, factor = 3, taps = 63 } = {}) {
  // Passband up to 90% of the OUTPUT Nyquist, expressed in cycles per input
  // sample: 0.9 * (1 / (2 * factor)).
  const h = designLowpass(taps, 0.9 / (2 * factor));
  let buf = new Float32Array(taps - 1); // history: taps-1 zeros to start

  return {
    process(interleaved) {
      const frames = Math.floor(interleaved.length / channels);
      const merged = new Float32Array(buf.length + frames);
      merged.set(buf, 0);
      if (channels === 1) {
        merged.set(interleaved.subarray(0, frames), buf.length);
      } else {
        const inv = 1 / channels;
        for (let f = 0; f < frames; f++) {
          let s = 0;
          const base = f * channels;
          for (let c = 0; c < channels; c++) s += interleaved[base + c];
          merged[buf.length + f] = s * inv;
        }
      }
      const outLen = Math.floor((merged.length - taps) / factor) + 1;
      const out = new Float32Array(Math.max(0, outLen));
      let p = 0;
      for (let k = 0; k < outLen; k++, p += factor) {
        let acc = 0;
        for (let t = 0; t < taps; t++) acc += h[t] * merged[p + t];
        out[k] = acc;
      }
      buf = merged.slice(p); // unconsumed tail, always < taps + factor samples
      return out;
    },
    reset() {
      buf = new Float32Array(taps - 1);
    },
  };
}

module.exports = { makeDownmixDecimator, designLowpass };
