// Demuxed blocks → mono Float32 PCM through WebCodecs, and the resampler
// that brings it to the channel's 16 kHz (for audio-feeder.js).

export class DecodeError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

// Mean of all planes, so a loud stereo mix does not clip.
export function mixToMono(audio) {
  const frames = audio.numberOfFrames;
  const channels = audio.numberOfChannels;
  const out = new Float32Array(frames);
  if (channels === 1) {
    audio.copyTo(out, { planeIndex: 0, format: 'f32-planar' });
    return out;
  }
  const plane = new Float32Array(frames);
  for (let c = 0; c < channels; c++) {
    audio.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
    for (let i = 0; i < frames; i++) out[i] += plane[i];
  }
  const k = 1 / channels;
  for (let i = 0; i < frames; i++) out[i] *= k;
  return out;
}

// track: the demuxer's track event. onPcm({ pcm, sampleRate, timeMs }) per
// decoded AudioData. Rejects with code 'unsupported' for AAC (not yet) and
// configs the browser cannot decode.
export async function createOpusDecoder({ track, onPcm, onError = () => {}, AudioDecoder: Decoder = globalThis.AudioDecoder, EncodedAudioChunk: Chunk = globalThis.EncodedAudioChunk }) {
  if (track.codec !== 'A_OPUS') throw new DecodeError('unsupported', track.codec);
  if (!Decoder || !Chunk) throw new DecodeError('unsupported', 'WebCodecs AudioDecoder is missing');
  const config = { codec: 'opus', sampleRate: 48000, numberOfChannels: track.channels };
  if (track.codecPrivate?.length) config.description = track.codecPrivate;
  const { supported } = await Decoder.isConfigSupported(config);
  if (!supported) throw new DecodeError('unsupported', `opus ${track.channels}ch`);

  let closed = false;
  const decoder = new Decoder({
    output: (audio) => {
      try {
        if (!closed) onPcm({ pcm: mixToMono(audio), sampleRate: audio.sampleRate, timeMs: audio.timestamp / 1000 });
      } catch (e) {
        onError(e);
      } finally {
        audio.close();
      }
    },
    error: (e) => {
      if (!closed) onError(new DecodeError('decode-failed', e?.message || String(e)));
    },
  });
  decoder.configure(config);
  return {
    // false once the decoder has failed or closed.
    decode(block) {
      if (decoder.state !== 'configured') return false;
      decoder.decode(new Chunk({ type: 'key', timestamp: Math.round(block.timeMs * 1000), data: block.data }));
      return true;
    },
    async flush() {
      if (decoder.state === 'configured') await decoder.flush();
    },
    close() {
      closed = true;
      if (decoder.state !== 'closed') decoder.close();
    },
    get queueSize() {
      return decoder.decodeQueueSize;
    },
  };
}

// push(Float32Array) → Float32Array at toRate, phase kept across pushes.
// An integer ratio (48k → 16k is 3:1) averages each group of input samples,
// which also filters what would alias; any other ratio interpolates linearly.
export function createResampler(fromRate, toRate = 16000) {
  if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError(`bad rates ${fromRate} → ${toRate}`);
  if (fromRate === toRate) return { push: (x) => Float32Array.from(x) };

  const ratio = fromRate / toRate;
  if (Number.isInteger(ratio)) {
    let acc = 0;
    let have = 0;
    return {
      push(x) {
        const out = new Float32Array(Math.floor((have + x.length) / ratio));
        let o = 0;
        for (let i = 0; i < x.length; i++) {
          acc += x[i];
          if (++have === ratio) {
            out[o++] = acc / ratio;
            acc = 0;
            have = 0;
          }
        }
        return out;
      },
    };
  }

  let t = 0; // next output position, in input samples from the start of this push (-1 is the previous push's last)
  let prev = 0;
  return {
    push(x) {
      const n = x.length;
      if (!n) return new Float32Array(0);
      // One spare slot for float rounding in the count.
      const out = new Float32Array(Math.max(0, Math.ceil((n - 1 - t) / ratio)) + 1);
      let o = 0;
      while (t < n - 1) {
        const i = Math.floor(t);
        const a = i < 0 ? prev : x[i];
        out[o++] = a + (x[i + 1] - a) * (t - i);
        t += ratio;
      }
      t -= n;
      prev = x[n - 1];
      return out.subarray(0, o);
    },
  };
}
