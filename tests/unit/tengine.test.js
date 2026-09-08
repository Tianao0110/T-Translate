// The T-Engine facade: registration, the status snapshot merged with the
// registry, event fan-out, and delegation of provider/health/shutdown.

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createTengine, ENGINES } = require('../../electron/tengine/index.js');

function fakeEngine(id, provider = 'cpu') {
  return {
    id,
    provider,
    setProvider: vi.fn(function (p) { this.provider = p; }),
    health: vi.fn(async () => ({ ok: true, provider })),
    shutdown: vi.fn(),
    status() {
      return { id, provider: this.provider, lastHealth: null, host: { running: false } };
    },
  };
}

describe('tengine facade', () => {
  it('merges live engines into the registry rows and leaves the rest idle', () => {
    const t = createTengine();
    t.register(fakeEngine('ocr'));
    const s = t.status();
    expect(s.provider).toBe('webgpu');
    expect(s.engines).toHaveLength(ENGINES.length);
    expect(s.engines.find((e) => e.id === 'ocr')).toMatchObject({ host: { running: false }, runtime: 'onnxruntime-node', provider: 'cpu' });
    expect(s.engines.find((e) => e.id === 'tts')).toMatchObject({ provider: 'cpu', lastHealth: null, host: null });
  });

  it('delegates provider, health and shutdown to the engine', async () => {
    const t = createTengine();
    const e = t.register(fakeEngine('ocr'));
    t.setProvider('ocr', 'webgpu');
    expect(e.setProvider).toHaveBeenCalledWith('webgpu');
    expect(t.status().engines.find((x) => x.id === 'ocr').provider).toBe('webgpu');
    await expect(t.health('ocr', { packId: 'base' })).resolves.toMatchObject({ ok: true });
    t.shutdownAll();
    expect(e.shutdown).toHaveBeenCalled();
    expect(() => t.get('asr')).toThrow(/unknown engine/);
  });

  it('fans events out to every listener and survives a throwing one', () => {
    const warn = vi.fn();
    const t = createTengine({ logger: { warn } });
    const seen = [];
    const off = t.on((evt) => seen.push(evt));
    t.on(() => { throw new Error('boom'); });
    t.emit({ engine: 'ocr', kind: 'spawn' });
    expect(seen).toEqual([{ engine: 'ocr', kind: 'spawn' }]);
    expect(warn).toHaveBeenCalled();
    off();
    t.emit({ engine: 'ocr', kind: 'ready' });
    expect(seen).toHaveLength(1);
  });
});
