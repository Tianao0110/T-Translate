// The GPU engine table is the contract between the switch, its dialog, the
// status rows and the self-tests: every row must say what the UI needs.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { GPU_ENGINES, GPU_PROVIDER, gpuCapableIds } = require('../../electron/shared/gpu-engines.js');

describe('gpu-engines table', () => {
  it('uses one provider for everything', () => {
    expect(GPU_PROVIDER).toBe('webgpu');
  });

  it('has unique ids and a runtime on every row', () => {
    const ids = GPU_ENGINES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of GPU_ENGINES) {
      expect(typeof e.runtime).toBe('string');
      expect(typeof e.gpu).toBe('boolean');
    }
  });

  it('explains every engine that stays on the CPU', () => {
    for (const e of GPU_ENGINES.filter((x) => !x.gpu)) expect(typeof e.reason).toBe('string');
  });

  it('lists OCR and the neural voice as GPU-capable, listen as CPU-only', () => {
    expect(gpuCapableIds().sort()).toEqual(['ocr', 'tts']);
    expect(GPU_ENGINES.find((e) => e.id === 'asr').gpu).toBe(false);
  });
});
