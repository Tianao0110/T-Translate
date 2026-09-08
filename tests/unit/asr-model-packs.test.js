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
      if (typeof tree[p] === 'string') return { isFile: () => true, isDirectory: () => false };
      if (Array.isArray(tree[p])) return { isFile: () => false, isDirectory: () => true };
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

// v0.4.8: the optional high-accuracy final engine resolves from its own pack
// type; its tokenizer is a directory, so vocab.json inside it is the probe.
describe('locateAsrModels — high-accuracy pack', () => {
  const hqPackJson = JSON.stringify({
    id: 'asr-hq-qwen3-0.6b',
    type: 'asr-hq',
    version: '1.0.0',
    model: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25',
    engine: 'qwen3-asr',
    files: { convFrontend: 'conv_frontend.onnx', encoder: 'encoder.int8.onnx', decoder: 'decoder.int8.onnx', tokenizer: 'tokenizer' },
  });
  const baseTree = {
    base: ['asr-base-sense-voice/', 'asr-hq-qwen3-0.6b/'],
    'base/asr-base-sense-voice/pack.json': basePackJson,
    'base/asr-base-sense-voice/model.int8.onnx': 'file',
    'base/asr-base-sense-voice/tokens.txt': 'file',
    'base/asr-base-sense-voice/silero_vad.onnx': 'file',
    'base/asr-hq-qwen3-0.6b/pack.json': hqPackJson,
    'base/asr-hq-qwen3-0.6b/conv_frontend.onnx': 'file',
    'base/asr-hq-qwen3-0.6b/encoder.int8.onnx': 'file',
    'base/asr-hq-qwen3-0.6b/decoder.int8.onnx': 'file',
  };

  it('resolves the engine files and tokenizer dir when complete', () => {
    const fs = makeFs({ ...baseTree, 'base/asr-hq-qwen3-0.6b/tokenizer/vocab.json': 'file' });
    const found = locateAsrModels('base', { fs, path: P });
    expect(found.hq).toEqual({
      convFrontend: 'base/asr-hq-qwen3-0.6b/conv_frontend.onnx',
      encoder: 'base/asr-hq-qwen3-0.6b/encoder.int8.onnx',
      decoder: 'base/asr-hq-qwen3-0.6b/decoder.int8.onnx',
      tokenizerDir: 'base/asr-hq-qwen3-0.6b/tokenizer',
      engine: 'qwen3-asr',
      modelName: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25',
      dirName: 'asr-hq-qwen3-0.6b',
    });
  });

  it('yields hq: null when the tokenizer is missing, without gating listen mode', () => {
    const fs = makeFs(baseTree);
    const found = locateAsrModels('base', { fs, path: P });
    expect(found).not.toBeNull();
    expect(found.hq).toBeNull();
  });

  it('never resolves hq without a base pack (the VAD lives there)', () => {
    const fs = makeFs({
      base: ['asr-hq-qwen3-0.6b/'],
      'base/asr-hq-qwen3-0.6b/pack.json': hqPackJson,
      'base/asr-hq-qwen3-0.6b/conv_frontend.onnx': 'file',
      'base/asr-hq-qwen3-0.6b/encoder.int8.onnx': 'file',
      'base/asr-hq-qwen3-0.6b/decoder.int8.onnx': 'file',
      'base/asr-hq-qwen3-0.6b/tokenizer/vocab.json': 'file',
    });
    expect(locateAsrModels('base', { fs, path: P })).toBeNull();
  });
});

// Link-only packs (shared/audio-packs MANUAL_PACKS): the upstream folder
// dropped in by hand resolves without pack.json; a half folder does not; a
// pack.json install of the same id wins.
const HQ_DIR = 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25';
function hqManualTree(dir = `base/${HQ_DIR}`) {
  return {
    [`${dir}/conv_frontend.onnx`]: 'file',
    [`${dir}/encoder.int8.onnx`]: 'file',
    [`${dir}/decoder.int8.onnx`]: 'file',
    [`${dir}/tokenizer`]: ['vocab.json'],
    [`${dir}/tokenizer/vocab.json`]: 'file',
  };
}

describe('hand-placed link-only packs', () => {
  it('lists the upstream folder as the high-accuracy pack and resolves it', () => {
    const fs = makeFs({ base: ['asr-base-sense-voice/', `${HQ_DIR}/`], ...basePackTree(), ...hqManualTree() });
    const packs = listInstalledPacks('base', { fs, path: P });
    expect(packs.find((p) => p.id === 'asr-hq-qwen3-0.6b')).toMatchObject({ type: 'asr-hq', manual: true, dirName: HQ_DIR, dir: `base/${HQ_DIR}` });
    const located = locateAsrModels('base', { fs, path: P });
    expect(located.hq).toMatchObject({ engine: 'qwen3-asr', tokenizerDir: `base/${HQ_DIR}/tokenizer`, dirName: HQ_DIR });
  });

  it('a folder missing a file is not a pack', () => {
    const tree = { base: ['asr-base-sense-voice/', `${HQ_DIR}/`], ...basePackTree(), ...hqManualTree() };
    delete tree[`base/${HQ_DIR}/decoder.int8.onnx`];
    const fs = makeFs(tree);
    expect(listInstalledPacks('base', { fs, path: P }).map((p) => p.id)).toEqual(['asr-base-sense-voice']);
    expect(locateAsrModels('base', { fs, path: P }).hq).toBeNull();
  });

  it('a pack.json install of the same id wins over the hand-placed folder', () => {
    const packJson = JSON.stringify({ id: 'asr-hq-qwen3-0.6b', type: 'asr-hq', version: '1.1.0', engine: 'qwen3-asr', files: { convFrontend: 'a.onnx', encoder: 'b.onnx', decoder: 'c.onnx', tokenizer: 'tok' } });
    const fs = makeFs({
      base: ['asr-base-sense-voice/', 'asr-hq-qwen3-0.6b/', `${HQ_DIR}/`],
      ...basePackTree(),
      ...hqManualTree(),
      'base/asr-hq-qwen3-0.6b/pack.json': packJson,
      'base/asr-hq-qwen3-0.6b/a.onnx': 'file',
      'base/asr-hq-qwen3-0.6b/b.onnx': 'file',
      'base/asr-hq-qwen3-0.6b/c.onnx': 'file',
      'base/asr-hq-qwen3-0.6b/tok/vocab.json': 'file',
    });
    const hq = listInstalledPacks('base', { fs, path: P }).filter((p) => p.id === 'asr-hq-qwen3-0.6b');
    expect(hq).toHaveLength(1);
    expect(hq[0]).toMatchObject({ version: '1.1.0', dirName: 'asr-hq-qwen3-0.6b' });
    expect(hq[0].manual).toBeUndefined();
  });
});
