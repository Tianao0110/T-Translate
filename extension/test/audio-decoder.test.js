// @vitest-environment node
//
// createAudioDecoder over a mocked WebCodecs AudioDecoder: the config it asks
// for (AAC with its AudioSpecificConfig as description, Opus as before),
// chunks as key frames in microseconds, PCM at the rate the decoder puts out
// (HE-AAC doubles it), and every way to end up 'unsupported'.

import { describe, it, expect, beforeEach } from 'vitest';
import { createAudioDecoder, decoderConfig } from '../src/offscreen/decode.js';

const ASC = Uint8Array.from([0x11, 0x88]);
const OPUS_HEAD = Uint8Array.from([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2]);
const aac = (extra = {}) => ({ type: 'track', number: 1, codec: 'mp4a.40.2', channels: 1, sampleRate: 48000, codecPrivate: ASC, ...extra });

class MockDecoder {
  static asked = [];
  static answer = { supported: true };
  static last = null;
  static outRate = 48000;

  static async isConfigSupported(config) {
    MockDecoder.asked.push(config);
    if (MockDecoder.answer instanceof Error) throw MockDecoder.answer;
    return { ...MockDecoder.answer, config };
  }

  constructor({ output, error }) {
    Object.assign(this, { output, error, state: 'unconfigured', chunks: [], decodeQueueSize: 0 });
    MockDecoder.last = this;
  }

  configure(config) {
    this.config = config;
    this.state = 'configured';
  }

  decode(chunk) {
    this.chunks.push(chunk);
  }

  // Two channels of 1024 frames per chunk, +0.5 and -0.1, at outRate.
  async flush() {
    for (const c of this.chunks.splice(0)) {
      let closed = false;
      this.output({
        numberOfFrames: 1024,
        numberOfChannels: 2,
        sampleRate: MockDecoder.outRate,
        timestamp: c.timestamp,
        copyTo: (dest, { planeIndex }) => dest.fill(planeIndex === 0 ? 0.5 : -0.1),
        close: () => (closed = true),
        get closed() {
          return closed;
        },
      });
    }
  }

  close() {
    this.state = 'closed';
  }
}

class MockChunk {
  constructor(init) {
    Object.assign(this, init);
  }
}

const open = (track, onPcm = () => {}) => createAudioDecoder({ track, onPcm, AudioDecoder: MockDecoder, EncodedAudioChunk: MockChunk });

beforeEach(() => {
  MockDecoder.asked = [];
  MockDecoder.answer = { supported: true };
  MockDecoder.outRate = 48000;
});

describe('AAC decoder', () => {
  it('configures with the track’s codec, rate, channels and AudioSpecificConfig; key chunks in µs', async () => {
    const pcm = [];
    const d = await open(aac(), (p) => pcm.push(p));
    const want = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1, description: ASC };
    expect(MockDecoder.asked).toEqual([want]);
    expect(MockDecoder.last.config).toEqual(want);
    const data = Uint8Array.from([1, 2, 3]);
    expect(d.decode({ timeMs: 1002.6666, data })).toBe(true);
    expect(MockDecoder.last.chunks).toEqual([new MockChunk({ type: 'key', timestamp: 1002667, data })]);
    await d.flush();
    expect(pcm).toHaveLength(1);
    expect(pcm[0]).toMatchObject({ sampleRate: 48000, timeMs: 1002.667 });
    expect(pcm[0].pcm).toHaveLength(1024);
    expect(pcm[0].pcm[0]).toBeCloseTo(0.2, 6);
    d.close();
    expect(d.decode({ timeMs: 0, data })).toBe(false);
  });

  it('HE-AAC: PCM comes at the rate the decoder puts out, not the track’s', async () => {
    MockDecoder.outRate = 96000;
    const pcm = [];
    const d = await open(aac({ codec: 'mp4a.40.5', sampleRate: 48000, codecPrivate: Uint8Array.from([0x2b, 0x11, 0x88]) }), (p) => pcm.push(p));
    expect(MockDecoder.asked[0].codec).toBe('mp4a.40.5');
    d.decode({ timeMs: 0, data: new Uint8Array(4) });
    await d.flush();
    expect(pcm[0].sampleRate).toBe(96000);
  });

  it('Opus keeps its config', () => {
    expect(decoderConfig({ codec: 'A_OPUS', channels: 2, codecPrivate: OPUS_HEAD })).toEqual({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, description: OPUS_HEAD });
    expect(decoderConfig({ codec: 'A_OPUS', channels: 1, codecPrivate: null })).toEqual({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
  });

  it('unsupported: the browser says no or calls the config invalid, other codecs, AAC without a config, no WebCodecs', async () => {
    const refused = async (promise) => expect(promise).rejects.toMatchObject({ code: 'unsupported' });
    MockDecoder.answer = { supported: false };
    await refused(open(aac()));
    MockDecoder.answer = new TypeError('invalid config');
    await refused(open(aac()));
    expect(MockDecoder.asked).toHaveLength(2);
    MockDecoder.answer = { supported: true };
    for (const codec of ['ac-3', 'ec-3', 'fLaC', 'Opus', 'mp4a.6b', 'A_AAC', 'A_VORBIS']) await refused(open(aac({ codec })));
    await refused(open(aac({ codecPrivate: null })));
    await refused(open(aac({ codec: 'mp4a', codecPrivate: null })));
    expect(MockDecoder.asked).toHaveLength(2);
    await refused(createAudioDecoder({ track: aac(), onPcm: () => {}, AudioDecoder: undefined, EncodedAudioChunk: MockChunk }));
    expect(decoderConfig(aac({ codec: 'mp4a.40.29' }))).toMatchObject({ codec: 'mp4a.40.29' });
    expect(decoderConfig(aac({ codec: 'mp4a.67' }))).toMatchObject({ codec: 'mp4a.67' });
  });
});
