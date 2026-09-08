// The engine table is the contract between the GPU switch, its dialog, the
// status rows, the self-tests and the T-Engine snapshot: every row must say
// what the UI needs and where the engine lives.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ENGINES, PROVIDER, gpuCapableIds, engineById } = require('../../electron/tengine/registry.js');

describe('tengine registry', () => {
  it('uses one provider for the onnxruntime engines', () => {
    expect(PROVIDER).toBe('webgpu');
  });

  it('has unique ids, a host and a runtime on every row', () => {
    const ids = ENGINES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ENGINES) {
      expect(typeof e.host).toBe('string');
      expect(typeof e.runtime).toBe('string');
      expect(typeof e.gpu).toBe('boolean');
    }
  });

  it('explains every engine that stays on the CPU', () => {
    for (const e of ENGINES.filter((x) => !x.gpu)) expect(typeof e.reason).toBe('string');
  });

  it('lists OCR and the neural voice as GPU-capable, listen as CPU-only', () => {
    expect(gpuCapableIds().sort()).toEqual(['ocr', 'tts']);
    expect(engineById('asr').gpu).toBe(false);
    expect(engineById('nope')).toBeNull();
  });
});
