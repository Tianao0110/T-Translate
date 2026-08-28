// ASR model discovery for the v0.4.0 distribution layout: packs installed by
// the pack manager (folder + pack.json whose `files` map names the roles) must
// win over hand-placed sherpa folders, and hand-placed folders must keep
// working for everyone who set the probe up before downloads existed.

import { describe, it, expect } from 'vitest';
import { locateAsrModels, listInstalledPacks } from '../../electron/utils/asr-models.js';

const P = { join: (...parts) => parts.join('/') };

// tree: { 'dir': ['entry/', 'file'], 'path/to/file': 'file' | '<json text>' }
function makeFs(tree) {
  return {
    readdirSync(dir) {
      const entries = tree[dir];
      if (!entries) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return entries.map((name) => ({
        name: name.replace(/\/$/, ''),
        isDirectory: () => name.endsWith('/'),
      }));
    },
    statSync(p) {
      if (typeof tree[p] === 'string') return { isFile: () => true };
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    },
    readFileSync(p) {
      if (typeof tree[p] === 'string') return tree[p];
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    },
  };
}

const basePackJson = JSON.stringify({
  id: 'asr-base-sense-voice',
  type: 'asr-base',
  version: '1.0.0',
  model: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17',
  files: { model: 'model.int8.onnx', tokens: 'tokens.txt', vad: 'silero_vad.onnx' },
});

const draftPackJson = JSON.stringify({
  id: 'asr-draft-zipformer-zh-en',
  type: 'asr-draft',
  version: '1.0.0',
  files: {
    encoder: 'encoder-epoch-99-avg-1.int8.onnx',
    decoder: 'decoder-epoch-99-avg-1.onnx',
    joiner: 'joiner-epoch-99-avg-1.int8.onnx',
    tokens: 'tokens.txt',
  },
});

function basePackTree(dir = 'base/asr-base-sense-voice') {
  return {
    [`${dir}/pack.json`]: basePackJson,
    [`${dir}/model.int8.onnx`]: 'file',
    [`${dir}/tokens.txt`]: 'file',
    [`${dir}/silero_vad.onnx`]: 'file',
  };
}

function draftPackTree(dir = 'base/asr-draft-zipformer-zh-en') {
  return {
    [`${dir}/pack.json`]: draftPackJson,
    [`${dir}/encoder-epoch-99-avg-1.int8.onnx`]: 'file',
    [`${dir}/decoder-epoch-99-avg-1.onnx`]: 'file',
    [`${dir}/joiner-epoch-99-avg-1.int8.onnx`]: 'file',
    [`${dir}/tokens.txt`]: 'file',
  };
}

describe('locateAsrModels — pack layout', () => {
  it('resolves the base engine and its VAD from inside the pack folder', () => {
    const fs = makeFs({ base: ['asr-base-sense-voice/'], ...basePackTree() });
    const found = locateAsrModels('base', { fs, path: P });
    expect(found.modelPath).toBe('base/asr-base-sense-voice/model.int8.onnx');
    // The VAD moved inside the pack — the old root-level location is gone
    expect(found.vadPath).toBe('base/asr-base-sense-voice/silero_vad.onnx');
    // modelName reports the upstream model, not our folder name
    expect(found.modelName).toContain('sense-voice');
    expect(found.streaming).toBeNull();
  });

  it('resolves the draft engine from its own pack', () => {
    const fs = makeFs({
      base: ['asr-base-sense-voice/', 'asr-draft-zipformer-zh-en/'],
      ...basePackTree(),
      ...draftPackTree(),
    });
    const found = locateAsrModels('base', { fs, path: P });
    expect(found.streaming.encoder).toBe(
      'base/asr-draft-zipformer-zh-en/encoder-epoch-99-avg-1.int8.onnx'
    );
  });

  it('ignores a pack whose declared files are not on disk', () => {
    const tree = basePackTree();
    delete tree['base/asr-base-sense-voice/tokens.txt'];
    const fs = makeFs({ base: ['asr-base-sense-voice/'], ...tree });
    expect(locateAsrModels('base', { fs, path: P })).toBeNull();
  });

  it('prefers a pack over a hand-placed folder', () => {
    const fs = makeFs({
      base: ['asr-base-sense-voice/', 'sherpa-onnx-sense-voice-old/', 'silero_vad.onnx'],
      ...basePackTree(),
      'base/silero_vad.onnx': 'file',
      'base/sherpa-onnx-sense-voice-old/model.int8.onnx': 'file',
      'base/sherpa-onnx-sense-voice-old/tokens.txt': 'file',
    });
    const found = locateAsrModels('base', { fs, path: P });
    expect(found.modelDir).toBe('base/asr-base-sense-voice');
  });

  it('pairs a downloaded base with a hand-placed draft', () => {
    const fs = makeFs({
      base: ['asr-base-sense-voice/', 'sherpa-onnx-streaming-zipformer-bilingual/'],
      ...basePackTree(),
      'base/sherpa-onnx-streaming-zipformer-bilingual/encoder-epoch-99-avg-1.int8.onnx': 'file',
      'base/sherpa-onnx-streaming-zipformer-bilingual/decoder-epoch-99-avg-1.onnx': 'file',
      'base/sherpa-onnx-streaming-zipformer-bilingual/joiner-epoch-99-avg-1.int8.onnx': 'file',
      'base/sherpa-onnx-streaming-zipformer-bilingual/tokens.txt': 'file',
    });
    const found = locateAsrModels('base', { fs, path: P });
    expect(found.modelDir).toBe('base/asr-base-sense-voice');
    expect(found.streaming.dirName).toBe('sherpa-onnx-streaming-zipformer-bilingual');
  });
});

describe('listInstalledPacks', () => {
  it('lists folders that carry a readable pack.json', () => {
    const fs = makeFs({
      base: ['asr-base-sense-voice/', 'asr-draft-zipformer-zh-en/'],
      ...basePackTree(),
      ...draftPackTree(),
    });
    const packs = listInstalledPacks('base', { fs, path: P });
    expect(packs.map((p) => p.id)).toEqual(['asr-base-sense-voice', 'asr-draft-zipformer-zh-en']);
    expect(packs[0].version).toBe('1.0.0');
  });

  it('skips hand-placed folders and unreadable metadata', () => {
    const fs = makeFs({
      base: ['sherpa-onnx-sense-voice-manual/', 'half-written/'],
      'base/sherpa-onnx-sense-voice-manual/model.int8.onnx': 'file',
      'base/half-written/pack.json': '{ not json',
    });
    expect(listInstalledPacks('base', { fs, path: P })).toEqual([]);
  });

  it('returns an empty list when the models dir is absent', () => {
    expect(listInstalledPacks('base', { fs: makeFs({}), path: P })).toEqual([]);
    expect(listInstalledPacks(null)).toEqual([]);
  });
});
