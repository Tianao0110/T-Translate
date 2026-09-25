// The DLL-free parts of the media paths: the prompt per family, the
// Spotting parser that turns <|LOC_n|> quadrilaterals into pixel boxes, the
// Qwen3-ASR reply split and the self-test WAV reader.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const { renderVisionPrompt, renderAudioPrompt, parseSpotting, parseAsrReply, readWav } = require('../../../electron/tengine/runtime/mtmd.js');

describe('renderVisionPrompt', () => {
  it('renders the PaddleOCR-VL template around the media marker', () => {
    expect(renderVisionPrompt('paddleocr', '<__media__>', 'Spotting')).toBe('<|begin_of_sentence|>User: <__media__>Spotting:\nAssistant:\n');
  });

  it('refuses a family it has no template for', () => {
    expect(() => renderVisionPrompt('qwen3', '<__media__>', 'OCR')).toThrow(expect.objectContaining({ code: 'LLM_VISION_UNSUPPORTED' }));
  });
});

describe('parseSpotting', () => {
  // Real model output for a 700x200 image whose labels were drawn at known spots.
  const output = [
    '文件<|LOC_64|><|LOC_96|><|LOC_130|><|LOC_96|><|LOC_130|><|LOC_224|><|LOC_64|><|LOC_224|>',
    'Translate now<|LOC_736|><|LOC_108|><|LOC_942|><|LOC_108|><|LOC_942|><|LOC_210|><|LOC_736|><|LOC_210|>',
    '',
    'Cancel<|LOC_738|><|LOC_704|><|LOC_836|><|LOC_704|><|LOC_836|><|LOC_808|><|LOC_738|><|LOC_808|>',
  ].join('\n');

  it('scales the 0..999 grid to pixels and keeps the reading order', () => {
    const lines = parseSpotting(output, 700, 200);
    expect(lines.map((l) => l.text)).toEqual(['文件', 'Translate now', 'Cancel']);
    expect(lines[0].box).toEqual([45, 19, 91, 45]);
    expect(lines[2].box).toEqual([517, 141, 585, 162]);
  });

  it('keeps text without a complete box and drops box-only lines', () => {
    const lines = parseSpotting('plain line\n<|LOC_1|><|LOC_2|><|LOC_3|><|LOC_4|><|LOC_5|><|LOC_6|><|LOC_7|><|LOC_8|>\nhalf<|LOC_9|><|LOC_9|>', 100, 100);
    expect(lines).toEqual([{ text: 'plain line', box: null }, { text: 'half', box: null }]);
  });

  it('normalises a quadrilateral given in any point order', () => {
    const lines = parseSpotting('x<|LOC_900|><|LOC_500|><|LOC_100|><|LOC_500|><|LOC_100|><|LOC_100|><|LOC_900|><|LOC_100|>', 1000, 1000);
    expect(lines[0].box).toEqual([100, 100, 900, 500]);
  });
});

describe('renderAudioPrompt', () => {
  it('renders Qwen3-ASR ChatML with an empty context around the media marker', () => {
    expect(renderAudioPrompt('qwen3-asr', '<__media__>')).toBe('<|im_start|>system\n<|im_end|>\n<|im_start|>user\n<__media__><|im_end|>\n<|im_start|>assistant\n');
  });

  it('refuses a family it has no template for', () => {
    expect(() => renderAudioPrompt('qwen3vl', '<__media__>')).toThrow(expect.objectContaining({ code: 'LLM_AUDIO_UNSUPPORTED' }));
    expect(() => renderAudioPrompt(null, '<__media__>')).toThrow(expect.objectContaining({ code: 'LLM_AUDIO_UNSUPPORTED' }));
  });
});

describe('parseAsrReply', () => {
  it('splits the language frame from the transcript', () => {
    expect(parseAsrReply('language Chinese<asr_text>今天天气很好，我们去公园散步吧。')).toEqual({ language: 'Chinese', transcript: '今天天气很好，我们去公园散步吧。' });
    expect(parseAsrReply('language English<asr_text> Hello there. ')).toEqual({ language: 'English', transcript: 'Hello there.' });
  });

  it('reads "None" as no speech', () => {
    expect(parseAsrReply('language None<asr_text>')).toEqual({ language: null, transcript: '' });
  });

  it('keeps an unframed reply whole and cuts at the last marker', () => {
    expect(parseAsrReply(' plain words ')).toEqual({ language: null, transcript: 'plain words' });
    expect(parseAsrReply('language English<asr_text>a<asr_text>b')).toEqual({ language: 'English', transcript: 'b' });
    expect(parseAsrReply(null)).toEqual({ language: null, transcript: '' });
  });
});

describe('readWav', () => {
  const wav = (format, bits, channels, rate, payload) => {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + payload.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(format, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE((rate * channels * bits) / 8, 28);
    header.writeUInt16LE((channels * bits) / 8, 32);
    header.writeUInt16LE(bits, 34);
    header.write('data', 36);
    header.writeUInt32LE(payload.length, 40);
    return Buffer.concat([header, payload]);
  };

  it('reads 16-bit PCM and 32-bit float as samples in [-1, 1]', () => {
    const pcm16 = Buffer.from(new Int16Array([0, 16384, -32768]).buffer);
    expect(Array.from(readWav(wav(1, 16, 1, 16000, pcm16), 16000))).toEqual([0, 0.5, -1]);
    const f32 = Buffer.from(new Float32Array([0.25, -0.5]).buffer);
    expect(Array.from(readWav(wav(3, 32, 1, 16000, f32), 16000))).toEqual([0.25, -0.5]);
  });

  it('refuses what the audio encoder cannot take as is', () => {
    const pcm16 = Buffer.from(new Int16Array([1, 2]).buffer);
    expect(() => readWav(wav(1, 16, 2, 16000, pcm16), 16000)).toThrow(expect.objectContaining({ code: 'LLM_BAD_AUDIO' }));
    expect(() => readWav(wav(1, 16, 1, 44100, pcm16), 16000)).toThrow(expect.objectContaining({ code: 'LLM_BAD_AUDIO' }));
    expect(() => readWav(wav(1, 8, 1, 16000, pcm16), 16000)).toThrow(expect.objectContaining({ code: 'LLM_BAD_AUDIO' }));
    expect(() => readWav(Buffer.from('not a wav at all'), 16000)).toThrow(expect.objectContaining({ code: 'LLM_BAD_AUDIO' }));
  });

  it('reads the bundled self-test sentence', () => {
    const file = path.resolve(__dirname, '../../../electron/tengine/runtime/assets/asr-health.wav');
    const pcm = readWav(fs.readFileSync(file), 16000);
    expect(pcm.length / 16000).toBeGreaterThan(3);
    expect(pcm.length / 16000).toBeLessThan(5);
    expect(Math.max(...pcm.map(Math.abs))).toBeLessThanOrEqual(1);
  });
});
