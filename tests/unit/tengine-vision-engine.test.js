// The built-in vision OCR engine over a fake localLlm: input decoding,
// Spotting lines to blocks, availability from the pack state, and honest
// failures (size cap, cancel) the manager can walk past.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import TengineVisionEngine, { imageBytes, linesToBlocks } from '../../src/stack/ocr/tengine-vision.js';
import { configureRuntime } from '../../src/stack/runtime.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;

function fakeLlm({ ready = true, gpu = true, result = null, reject = null } = {}) {
  const recognize = vi.fn(async (req) => ({
    reqId: 'g1',
    cancel: vi.fn(),
    promise: reject ? Promise.reject(reject) : Promise.resolve(result || { text: '文件<|LOC_64|>', stop: 'eog', lines: [{ text: '文件', box: [45, 19, 91, 45] }, { text: 'no box', box: null }], width: 700, height: 200, imageTokens: 175, promptMs: 50, totalMs: 200, genTokens: 12 }),
  }));
  return {
    recognize,
    visionStatus: () => ({ available: true, usable: ready && gpu, pack: ready ? { id: 'paddleocr-vl-1.6', status: 'ready' } : { id: 'paddleocr-vl-1.6', status: 'partial' }, provider: gpu ? 'gpu' : 'cpu' }),
    generate: vi.fn(),
    status: () => ({}),
    selected: () => null,
  };
}

beforeEach(() => {
  configureRuntime({ fetch: vi.fn(), getLanguage: () => 'zh', localLlm: null });
});

describe('imageBytes', () => {
  it('strips a data URL, accepts bare base64 and passes bytes through', () => {
    expect(Buffer.from(imageBytes(DATA_URL))).toEqual(PNG);
    expect(Buffer.from(imageBytes(PNG.toString('base64')))).toEqual(PNG);
    expect(imageBytes(new Uint8Array([1, 2]))).toEqual(new Uint8Array([1, 2]));
    expect(imageBytes(42)).toBeNull();
  });
});

describe('linesToBlocks', () => {
  it('turns boxes into bboxes and drops lines without one', () => {
    const blocks = linesToBlocks([{ text: '文件', box: [45, 19, 91, 45] }, { text: 'x', box: null }, { text: '', box: [0, 0, 1, 1] }]);
    expect(blocks).toEqual([{ text: '文件', confidence: 0.9, bbox: { x: 45, y: 19, width: 46, height: 26 }, index: 0 }]);
  });
});

describe('TengineVisionEngine', () => {
  it('is available only with the hook, a ready pack and the GPU', async () => {
    const e = new TengineVisionEngine();
    expect(await e.isAvailable()).toBe(false);
    configureRuntime({ localLlm: fakeLlm({ ready: false }) });
    expect(await e.isAvailable()).toBe(false);
    configureRuntime({ localLlm: fakeLlm({ gpu: false }) });
    expect(await e.isAvailable()).toBe(false);
    configureRuntime({ localLlm: fakeLlm() });
    expect(await e.isAvailable()).toBe(true);
  });

  it('sends the decoded bytes with the Spotting task and returns line blocks', async () => {
    const llm = fakeLlm();
    configureRuntime({ localLlm: llm });
    const r = await new TengineVisionEngine().recognize(DATA_URL, {});
    expect(llm.recognize).toHaveBeenCalledWith({ image: expect.any(Buffer), task: 'Spotting' });
    expect(Buffer.from(llm.recognize.mock.calls[0][0].image)).toEqual(PNG);
    expect(r).toMatchObject({ success: true, engine: 'tengine-vision', text: '文件\nno box', confidence: 0.9 });
    expect(r.blocks).toHaveLength(1);
    expect(r.rawBlocks).toBe(r.blocks);
    expect(r.blocks[0].bbox).toEqual({ x: 45, y: 19, width: 46, height: 26 });
  });

  it('reports the host refusal with its code instead of throwing', async () => {
    const err = Object.assign(new Error('800x600 exceeds 300000 pixels on this backend'), { code: 'LLM_IMAGE_TOO_LARGE' });
    configureRuntime({ localLlm: fakeLlm({ reject: err }) });
    const r = await new TengineVisionEngine().recognize(DATA_URL, {});
    expect(r).toEqual({ success: false, error: err.message, errorCode: 'LLM_IMAGE_TOO_LARGE' });
  });

  it('a cancelled or stalled generation is a failure, and an abort signal cancels the request', async () => {
    const llm = fakeLlm({ result: { text: '', stop: 'cancel', lines: [] } });
    configureRuntime({ localLlm: llm });
    const ac = new AbortController();
    const r = await new TengineVisionEngine().recognize(DATA_URL, { signal: ac.signal });
    expect(r.success).toBe(false);
    ac.abort();
    // The listener is removed once the request settled: no cancel after the fact.
    const g = await llm.recognize.mock.results[0].value;
    expect(g.cancel).not.toHaveBeenCalled();
  });
});
