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

  it('lists OCR, the neural voice and the built-in model as GPU-capable, listen as CPU-only', () => {
    expect(gpuCapableIds().sort()).toEqual(['llm', 'ocr', 'tts']);
    expect(engineById('asr').gpu).toBe(false);
    expect(engineById('nope')).toBeNull();
  });

  it('names the backend where it is not the shared onnxruntime provider', () => {
    expect(engineById('llm')).toMatchObject({ host: 'llm', runtime: 'llama.cpp', backend: 'vulkan' });
    for (const e of ENGINES.filter((x) => x.gpu && x.id !== 'llm')) expect(e.backend).toBeUndefined();
  });
});
