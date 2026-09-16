// Downmix + integer-factor FIR decimation for the process-loopback path
// (48 kHz stereo to 16 kHz mono), free of native imports. Why the engine's
// own conversion is not used: docs/design/listen.md §5.

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

module.exports = { makeDownmixDecimator, };
