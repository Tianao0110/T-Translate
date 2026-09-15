// The built-in vision engine inside the OCR manager's chain: its place in
// the default walk, being skipped while uninstalled, the degrade to the
// classic local engines when it is the preferred engine and refuses, and
// the offline allowlist.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OCREngineManager, DEFAULT_OCR_PRIORITY } from '../../src/stack/ocr/manager.js';
import { configureRuntime } from '../../src/stack/runtime.js';
import { getPrivacyModeConfig } from '../../src/stack/privacy-modes.js';

const IMG = 'data:image/png;base64,iVBORw0KGgo=';

let paddleMock;
let windowsMock;
let recognizeMock;

function llm({ ready = true, lines = [{ text: '文件', box: [45, 19, 91, 45] }], reject = null } = {}) {
  recognizeMock = vi.fn(async () => ({
    reqId: 'g1',
    cancel: vi.fn(),
    promise: reject ? Promise.reject(reject) : Promise.resolve({ text: 'raw', stop: 'eog', lines, width: 700, height: 200 }),
  }));
  return {
    recognize: recognizeMock,
    visionStatus: () => ({ available: true, pack: { id: 'paddleocr-vl-1.6', status: ready ? 'ready' : 'missing' }, provider: 'cpu' }),
    generate: vi.fn(),
    status: () => ({}),
    selected: () => null,
  };
}

beforeEach(() => {
  paddleMock = vi.fn(async () => ({ success: true, text: 'local text', blocks: [], rawBlocks: [] }));
  windowsMock = vi.fn(async () => ({ success: true, text: 'win text' }));
  configureRuntime({
    fetch: vi.fn(),
    getLanguage: () => 'zh',
    localOcr: { paddle: paddleMock, windows: windowsMock, isWindows: true },
    localLlm: null,
  });
});

async function makeManager() {
  const manager = new OCREngineManager({ loadConfigs: async () => ({}) });
  await manager.init();
  return manager;
}

describe('built-in vision engine in the OCR chain', () => {
  it('sits third in the default order, behind the two classic local engines', () => {
    expect(DEFAULT_OCR_PRIORITY.slice(0, 4)).toEqual(['rapid-ocr', 'windows-ocr', 'tengine-vision', 'llm-vision']);
    expect(getPrivacyModeConfig('offline').allowedOcrEngines).toContain('tengine-vision');
  });

  it('serves a capture with line boxes when chosen', async () => {
    configureRuntime({ localLlm: llm() });
    const manager = await makeManager();
    const r = await manager.recognize(IMG, { engine: 'tengine-vision' });
    expect(r.success).toBe(true);
    expect(r.engine).toBe('tengine-vision');
    expect(r.blocks[0].bbox).toEqual({ x: 45, y: 19, width: 46, height: 26 });
    expect(recognizeMock).toHaveBeenCalledTimes(1);
    expect(paddleMock).not.toHaveBeenCalled();
  });

  it('is skipped in the priority walk while the pack is not installed', async () => {
    configureRuntime({ localLlm: llm({ ready: false }) });
    paddleMock = vi.fn(async () => ({ success: false, error: 'no models', errorCode: 'BASE_MODELS_MISSING' }));
    windowsMock = vi.fn(async () => ({ success: false, error: 'nope' }));
    configureRuntime({ localOcr: { paddle: paddleMock, windows: windowsMock, isWindows: true } });
    const manager = await makeManager();
    const r = await manager.recognize(IMG, { priority: ['rapid-ocr', 'windows-ocr', 'tengine-vision'] });
    expect(r.success).toBe(false);
    expect(recognizeMock).not.toHaveBeenCalled();
  });

  it('degrades to the classic local engines when preferred and refusing, and says so', async () => {
    const err = Object.assign(new Error('800x600 exceeds 300000 pixels on this backend'), { code: 'LLM_IMAGE_TOO_LARGE' });
    configureRuntime({ localLlm: llm({ reject: err }) });
    const manager = await makeManager();
    const r = await manager.recognize(IMG, { engine: 'tengine-vision' });
    expect(r.success).toBe(true);
    expect(r.engine).toBe('rapid-ocr');
    expect(r.fallbackFrom).toBe('tengine-vision');
    expect(r.fallbackReason).toBe(err.message);
    // The degrade never loops back into the vision engine.
    expect(recognizeMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the refusal when nothing else can read the capture', async () => {
    const err = Object.assign(new Error('no vision model installed'), { code: 'LLM_VISION_MISSING' });
    configureRuntime({ localLlm: llm({ reject: err }), localOcr: { paddle: vi.fn(async () => ({ success: false, error: 'x' })), windows: vi.fn(async () => ({ success: false, error: 'y' })), isWindows: true } });
    const manager = await makeManager();
    const r = await manager.recognize(IMG, { engine: 'tengine-vision' });
    expect(r).toMatchObject({ success: false, error: err.message, errorCode: 'LLM_VISION_MISSING' });
  });
});
