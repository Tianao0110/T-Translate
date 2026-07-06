// Stack OCREngineManager: the behaviors that must survive the main-process
// migration — privacy allowlist filtering, the LLM-Vision degrade/lock chain
// (now global across windows, lock flag rides on results), and per-request
// priority (a shared instance must not inherit one window's ordering).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OCREngineManager } from '../../src/stack/ocr/manager.js';
import { configureRuntime } from '../../src/stack/runtime.js';

const IMG = 'data:image/png;base64,AAAA';

function visionUnsupportedResponse() {
  return {
    ok: false,
    status: 400,
    text: async () => 'this model does not support vision inputs',
    json: async () => ({}),
  };
}

let paddleMock;
let windowsMock;

beforeEach(() => {
  paddleMock = vi.fn(async () => ({ success: true, text: 'local text', blocks: [], rawBlocks: [] }));
  windowsMock = vi.fn(async () => ({ success: true, text: 'win text' }));
  configureRuntime({
    fetch: vi.fn(async () => visionUnsupportedResponse()),
    getLanguage: () => 'zh',
    localOcr: { paddle: paddleMock, windows: windowsMock, isWindows: true },
  });
});

async function makeManager(settings = {}) {
  const manager = new OCREngineManager({ loadConfigs: async () => settings });
  await manager.init();
  return manager;
}

describe('stack OCREngineManager', () => {
  it('disallowed preferred engine falls through to the filtered local chain (no network)', async () => {
    const fetchMock = vi.fn();
    configureRuntime({ fetch: fetchMock });
    const manager = await makeManager({ ocrspaceKey: 'k-123' });

    const result = await manager.recognize(IMG, {
      engine: 'ocrspace',
      allowedEngines: ['llm-vision', 'windows-ocr', 'rapid-ocr'], // OFFLINE set
    });

    expect(result.success).toBe(true);
    expect(result.engine).toBe('rapid-ocr');
    expect(paddleMock).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('vision-unsupported degrades to local chain, then locks after 2 failures', async () => {
    const fetchMock = vi.fn(async () => visionUnsupportedResponse());
    configureRuntime({ fetch: fetchMock });
    const manager = await makeManager();

    const first = await manager.recognize(IMG, { engine: 'llm-vision' });
    expect(first.success).toBe(true);
    expect(first.fallbackFrom).toBe('llm-vision');
    expect(first.visionLocked).toBe(false);
    expect(manager.isVisionLocked()).toBe(false);

    const second = await manager.recognize(IMG, { engine: 'llm-vision' });
    expect(second.visionLocked).toBe(true);
    expect(manager.isVisionLocked()).toBe(true);

    // Locked: goes straight to the local chain without touching the endpoint
    const callsBefore = fetchMock.mock.calls.length;
    const third = await manager.recognize(IMG, { engine: 'llm-vision' });
    expect(third.success).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);

    manager.resetVisionFallback();
    expect(manager.isVisionLocked()).toBe(false);
  });

  it('per-request priority reorders the walk without mutating shared state', async () => {
    const manager = await makeManager();

    const result = await manager.recognize(IMG, { priority: ['windows-ocr'] });
    expect(result.engine).toBe('windows-ocr');
    expect(windowsMock).toHaveBeenCalled();
    expect(paddleMock).not.toHaveBeenCalled();

    // Next request without priority uses the default order again
    const next = await manager.recognize(IMG, {});
    expect(next.engine).toBe('rapid-ocr');
  });
});
