import { describe, it, expect } from 'vitest';
import { parseAsrResultJson, stripAsrFrame } from '../../electron/services/audio-engine/asr-result.js';

// The shape sherpa-onnx's OfflineRecognitionResult::AsJsonString emits.
const raw = (text, tokens) => `{"lang": "", "emotion": "", "event": "", "text": "${text}", "timestamps": [], "durations": [], "tokens":[${tokens.map((t) => `"${t}"`).join(', ')}], "words": []}`;
const NUL = String.fromCharCode(0);

describe('parseAsrResultJson', () => {
  it('parses a clean result unchanged', () => {
    const r = parseAsrResultJson(raw('很快，配备了防暴装备的警察', ['很快', '，']));
    expect(r.text).toBe('很快，配备了防暴装备的警察');
    expect(r.tokens).toEqual(['很快', '，']);
  });

  it('survives an unescaped newline that JSON.parse rejects', () => {
    const doc = raw('提纲：\n', ['提纲', '：', '\n']);
    expect(() => JSON.parse(doc)).toThrow(SyntaxError);
    const r = parseAsrResultJson(doc);
    expect(r.text.trim()).toBe('提纲：');
    expect(r.tokens).toHaveLength(3);
  });

  it('turns other control characters into spaces', () => {
    const r = parseAsrResultJson(raw(`one\ttwo${NUL}three`, ['one']));
    expect(r.text).toBe('one two three');
  });
});

describe('stripAsrFrame', () => {
  it('drops a leaked Qwen3-ASR frame and keeps the words after it', () => {
    expect(stripAsrFrame('提纲 language Chinese<asr_text>很快，配备了防暴装备的警察。')).toBe('很快，配备了防暴装备的警察。');
  });

  it('leaves ordinary text and empty results alone', () => {
    expect(stripAsrFrame('很快，配备了防暴装备的警察。')).toBe('很快，配备了防暴装备的警察。');
    expect(stripAsrFrame(undefined)).toBe('');
  });
});
