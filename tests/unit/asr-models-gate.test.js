// ASR model gate: the probe entry must appear only when a complete
// SenseVoice + VAD model set is manually placed under asr-models.

import { describe, it, expect } from 'vitest';
import { locateAsrModels } from '../../electron/utils/asr-models.js';

const P = { join: (...parts) => parts.join('/') };

function makeFs(tree) {
  // tree: { 'dir': ['entryDir/', 'file'], 'path/to/file': 'file' }
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
      if (tree[p] === 'file') return { isFile: () => true };
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    },
  };
}

describe('locateAsrModels', () => {
  it('returns null when the base dir does not exist', () => {
    expect(locateAsrModels('base', { fs: makeFs({}), path: P })).toBeNull();
  });

  it('returns null without a falsy base dir', () => {
    expect(locateAsrModels(null)).toBeNull();
  });

  it('returns null when the VAD model is missing', () => {
    const fs = makeFs({
      base: ['sense-voice-x/'],
      'base/sense-voice-x/model.int8.onnx': 'file',
      'base/sense-voice-x/tokens.txt': 'file',
    });
    expect(locateAsrModels('base', { fs, path: P })).toBeNull();
  });

  it('returns null when every sense-voice dir is incomplete', () => {
    const fs = makeFs({
      base: ['silero_vad.onnx', 'sense-voice-x/'],
      'base/silero_vad.onnx': 'file',
      'base/sense-voice-x/model.int8.onnx': 'file',
      // tokens.txt missing
    });
    expect(locateAsrModels('base', { fs, path: P })).toBeNull();
  });

  it('ignores non sense-voice dirs and plain files', () => {
    const fs = makeFs({
      base: ['silero_vad.onnx', 'other-model/', 'readme.txt'],
      'base/silero_vad.onnx': 'file',
      'base/other-model/model.int8.onnx': 'file',
      'base/other-model/tokens.txt': 'file',
    });
    expect(locateAsrModels('base', { fs, path: P })).toBeNull();
  });

  it('finds a complete sense-voice model set (no ten-vad -> tenVadPath null)', () => {
    const fs = makeFs({
      base: ['silero_vad.onnx', 'sherpa-onnx-sense-voice-int8-2024-07-17/'],
      'base/silero_vad.onnx': 'file',
      'base/sherpa-onnx-sense-voice-int8-2024-07-17/model.int8.onnx': 'file',
      'base/sherpa-onnx-sense-voice-int8-2024-07-17/tokens.txt': 'file',
    });
    const found = locateAsrModels('base', { fs, path: P });
    expect(found).not.toBeNull();
    expect(found.modelName).toBe('sherpa-onnx-sense-voice-int8-2024-07-17');
    expect(found.vadPath).toBe('base/silero_vad.onnx');
    expect(found.tenVadPath).toBeNull();
    expect(found.modelPath).toBe('base/sherpa-onnx-sense-voice-int8-2024-07-17/model.int8.onnx');
    expect(found.tokensPath).toBe('base/sherpa-onnx-sense-voice-int8-2024-07-17/tokens.txt');
  });

  it('reports ten-vad when present, as an optional upgrade path', () => {
    const fs = makeFs({
      base: ['silero_vad.onnx', 'ten-vad.onnx', 'sense-voice-x/'],
      'base/silero_vad.onnx': 'file',
      'base/ten-vad.onnx': 'file',
      'base/sense-voice-x/model.int8.onnx': 'file',
      'base/sense-voice-x/tokens.txt': 'file',
    });
    const found = locateAsrModels('base', { fs, path: P });
    expect(found.tenVadPath).toBe('base/ten-vad.onnx');
  });

  it('ten-vad alone does not satisfy the gate — silero stays required', () => {
    const fs = makeFs({
      base: ['ten-vad.onnx', 'sense-voice-x/'],
      'base/ten-vad.onnx': 'file',
      'base/sense-voice-x/model.int8.onnx': 'file',
      'base/sense-voice-x/tokens.txt': 'file',
    });
    expect(locateAsrModels('base', { fs, path: P })).toBeNull();
  });

  it('skips an incomplete candidate and picks the next complete one, sorted', () => {
    const fs = makeFs({
      base: ['silero_vad.onnx', 'sense-voice-b/', 'sense-voice-a/'],
      'base/silero_vad.onnx': 'file',
      // a sorts first but is incomplete
      'base/sense-voice-a/model.int8.onnx': 'file',
      'base/sense-voice-b/model.int8.onnx': 'file',
      'base/sense-voice-b/tokens.txt': 'file',
    });
    const found = locateAsrModels('base', { fs, path: P });
    expect(found.modelName).toBe('sense-voice-b');
  });
});
