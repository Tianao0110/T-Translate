// Installed voice pack discovery: pack.json `files` resolved to absolute
// paths, with the whole pack skipped when any piece is missing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listVoicePacks } from '../../electron/utils/tts-models.js';

let root;

function writePack(id, meta, files) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of files) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  }
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id, type: 'tts-voice', version: '1.0.0', ...meta }));
  return dir;
}

const kokoroMeta = {
  engine: 'kokoro',
  sampleRate: 24000,
  languages: ['zh', 'en'],
  files: {
    model: 'model.onnx',
    voices: 'voices.bin',
    tokens: 'tokens.txt',
    dataDir: 'espeak-ng-data',
    dictDir: 'dict',
    lexicon: ['lexicon-us-en.txt', 'lexicon-zh.txt'],
    ruleFsts: ['date-zh.fst'],
  },
  voiceGroups: [{ from: 0, to: 1, lang: 'en', gender: 'f' }],
  featured: [0],
  preferMixed: false,
};
const kokoroFiles = [
  'model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt', 'date-zh.fst',
  'espeak-ng-data/phontab', 'dict/jieba.dict.utf8',
];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-tts-models-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('listVoicePacks', () => {
  it('resolves every role to an absolute path, lists stay lists', () => {
    const dir = writePack('tts-kokoro-zh-en', kokoroMeta, kokoroFiles);
    const packs = listVoicePacks([root]);
    expect(packs).toHaveLength(1);
    const p = packs[0];
    expect(p.engine).toBe('kokoro');
    expect(p.paths.model).toBe(path.join(dir, 'model.onnx'));
    expect(p.paths.dataDir).toBe(path.join(dir, 'espeak-ng-data'));
    expect(p.paths.lexicon).toEqual([path.join(dir, 'lexicon-us-en.txt'), path.join(dir, 'lexicon-zh.txt')]);
    expect(p.paths.ruleFsts).toEqual([path.join(dir, 'date-zh.fst')]);
    expect(p.voiceGroups).toEqual(kokoroMeta.voiceGroups);
    expect(p.featured).toEqual([0]);
    expect(p.speedScale).toBe(1); // kokoro has no correction
  });

  it('speedScale comes from pack.json, else the engine default (MeloTTS Chinese runs fast)', () => {
    writePack('tts-melo-zh-en', { engine: 'vits', files: { model: 'model.onnx', tokens: 'tokens.txt' }, voiceGroups: [] }, ['model.onnx', 'tokens.txt']);
    expect(listVoicePacks([root])[0].speedScale).toEqual({ zh: 0.9, en: 1 });
    writePack('tts-melo-zh-en', { engine: 'vits', files: { model: 'model.onnx', tokens: 'tokens.txt' }, voiceGroups: [], speedScale: 0.9 }, ['model.onnx', 'tokens.txt']);
    expect(listVoicePacks([root])[0].speedScale).toBe(0.9);
  });

  it('skips a pack with a missing file instead of handing the worker a broken config', () => {
    writePack('tts-kokoro-zh-en', kokoroMeta, kokoroFiles.filter((f) => f !== 'lexicon-zh.txt'));
    expect(listVoicePacks([root])).toEqual([]);
  });

  it('skips non-voice packs and unknown engines', () => {
    writePack('asr-base-sense-voice', { type: 'asr-base', files: { model: 'm.onnx', tokens: 't.txt' } }, ['m.onnx', 't.txt']);
    writePack('tts-future', { engine: 'matcha', files: { model: 'm.onnx', tokens: 't.txt' } }, ['m.onnx', 't.txt']);
    expect(listVoicePacks([root])).toEqual([]);
  });

  it('the later root wins on an id collision', () => {
    const legacy = path.join(root, 'legacy');
    const active = path.join(root, 'active');
    fs.mkdirSync(legacy);
    fs.mkdirSync(active);
    const saved = root;
    root = legacy;
    writePack('tts-melo-zh-en', { engine: 'vits', version: '0.9.0', files: { model: 'model.onnx', tokens: 'tokens.txt' }, voiceGroups: [] }, ['model.onnx', 'tokens.txt']);
    root = active;
    writePack('tts-melo-zh-en', { engine: 'vits', version: '1.0.0', files: { model: 'model.onnx', tokens: 'tokens.txt' }, voiceGroups: [] }, ['model.onnx', 'tokens.txt']);
    root = saved;
    const packs = listVoicePacks([active, legacy]);
    expect(packs).toHaveLength(1);
    expect(packs[0].version).toBe('1.0.0');
    expect(packs[0].dir).toBe(path.join(active, 'tts-melo-zh-en'));
  });
});
