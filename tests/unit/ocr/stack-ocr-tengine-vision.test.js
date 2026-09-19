// The built-in vision engine inside the OCR manager: its place in the
// default walk and the offline allowlist, being skipped while unusable,
// and the smart routing when it is the selected engine — PP-OCR keeps the
// simple captures, the vision model takes the hard ones, and either side
// failing leaves a usable answer.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OCREngineManager, DEFAULT_OCR_PRIORITY } from '../../../src/stack/ocr/manager.js';
import { configureRuntime } from '../../../src/stack/runtime.js';
import { getPrivacyModeConfig } from '../../../src/stack/privacy-modes.js';

const IMG = 'data:image/png;base64,iVBORw0KGgo=';
// Lines carry as much text as their width holds: the quality gate counts
// characters per line-height and would call a sparse fixture unreadable.
const LINE = (text, y) => ({ text, confidence: 0.98, bbox: { x: 20, y, width: 500, height: 20 } });
const PROSE = 'the quick brown fox jumps over';
const SIMPLE = { success: true, text: `${PROSE}\n${PROSE}`, confidence: 0.98, blocks: [LINE(PROSE, 20), LINE(PROSE, 50)], rawBlocks: [LINE(PROSE, 20), LINE(PROSE, 50)] };
const TABLE_LINES = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) TABLE_LINES.push({ text: `cell${r}${c}`, confidence: 0.98, bbox: { x: 20 + c * 160, y: 20 + r * 32, width: 120, height: 20 } });
const TABLE = { success: true, text: TABLE_LINES.map((l) => l.text).join('\n'), confidence: 0.98, blocks: TABLE_LINES, rawBlocks: TABLE_LINES };

let paddleMock;
let windowsMock;
let recognizeMock;

function llm({ usable = true, lines = [{ text: '文件', box: [45, 19, 91, 45] }], reject = null } = {}) {
  recognizeMock = vi.fn(async () => ({
    reqId: 'g1',
    cancel: vi.fn(),
    promise: reject ? Promise.reject(reject) : Promise.resolve({ text: 'raw', stop: 'eog', lines, width: 700, height: 200 }),
  }));
  return {
    recognize: recognizeMock,
    visionStatus: () => ({ available: true, usable, pack: { id: 'paddleocr-vl-1.6', status: 'ready' }, provider: usable ? 'gpu' : 'cpu' }),
    generate: vi.fn(),
    status: () => ({}),
    selected: () => null,
  };
}

function useLocal({ paddle = async () => SIMPLE, windows = async () => ({ success: true, text: 'win text' }) } = {}) {
  paddleMock = vi.fn(paddle);
  windowsMock = vi.fn(windows);
  configureRuntime({ localOcr: { paddle: paddleMock, windows: windowsMock, isWindows: true } });
}

beforeEach(() => {
  configureRuntime({ fetch: vi.fn(), getLanguage: () => 'zh', localLlm: null });
  useLocal();
});

async function makeManager() {
  const manager = new OCREngineManager({ loadConfigs: async () => ({}) });
  await manager.init();
  return manager;
}

describe('built-in vision engine in the OCR chain', () => {
  it('sits third in the default order and inside the offline allowlist', () => {
    expect(DEFAULT_OCR_PRIORITY.slice(0, 4)).toEqual(['rapid-ocr', 'windows-ocr', 'tengine-vision', 'llm-vision']);
    expect(getPrivacyModeConfig('offline').allowedOcrEngines).toContain('tengine-vision');
  });

  it('is skipped in the priority walk while unusable (pack missing or GPU off)', async () => {
    configureRuntime({ localLlm: llm({ usable: false }) });
    useLocal({ paddle: async () => ({ success: false, error: 'no models', errorCode: 'BASE_MODELS_MISSING' }), windows: async () => ({ success: false, error: 'nope' }) });
    const manager = await makeManager();
    const r = await manager.recognize(IMG, { priority: ['rapid-ocr', 'windows-ocr', 'tengine-vision'] });
    expect(r.success).toBe(false);
    expect(recognizeMock).not.toHaveBeenCalled();
  });

  it('when selected, keeps a simple capture on PP-OCR and says so', async () => {
    configureRuntime({ localLlm: llm() });
    const manager = await makeManager();
    const r = await manager.recognize(IMG, { engine: 'tengine-vision' });
    expect(r.success).toBe(true);
    expect(r.engine).toBe('rapid-ocr');
    expect(r.routed).toEqual({ engine: 'tengine-vision', to: 'rapid-ocr', reason: 'simple' });
    expect(recognizeMock).not.toHaveBeenCalled();
    expect(paddleMock).toHaveBeenCalledTimes(1);
  });

  it('when selected, sends a table-like capture on to the vision model with line boxes', async () => {
    configureRuntime({ localLlm: llm() });
    useLocal({ paddle: async () => TABLE });
    const manager = await makeManager();
    const r = await manager.recognize(IMG, { engine: 'tengine-vision' });
    expect(r.engine).toBe('tengine-vision');
    expect(r.routed).toEqual({ engine: 'tengine-vision', to: 'tengine-vision', reason: 'table' });
    expect(r.blocks[0].bbox).toEqual({ x: 45, y: 19, width: 46, height: 26 });
    expect(recognizeMock).toHaveBeenCalledTimes(1);
  });

  it('takes over when PP-OCR cannot read the capture at all', async () => {
    configureRuntime({ localLlm: llm() });
    useLocal({ paddle: async () => ({ success: false, error: 'no models', errorCode: 'BASE_MODELS_MISSING' }) });
    const manager = await makeManager();
    const r = await manager.recognize(IMG, { engine: 'tengine-vision' });
    expect(r.engine).toBe('tengine-vision');
    expect(r.routed.reason).toBe('unreadable');
  });

  it('lets PP-OCR\'s read stand when the vision model fails on a hard capture', async () => {
    const err = Object.assign(new Error('host stalled'), { code: 'LLM_UNHEALTHY' });
    configureRuntime({ localLlm: llm({ reject: err }) });
    useLocal({ paddle: async () => TABLE });
    const manager = await makeManager();
    const r = await manager.recognize(IMG, { engine: 'tengine-vision' });
    expect(r.success).toBe(true);
    expect(r.engine).toBe('rapid-ocr');
    expect(r.routed).toEqual({ engine: 'tengine-vision', to: 'rapid-ocr', reason: 'table', visionFailed: true });
  });

  it('serves the capture with the classic engines and a notice while the engine is unusable', async () => {
    configureRuntime({ localLlm: llm({ usable: false }) });
    const manager = await makeManager();
    const r = await manager.recognize(IMG, { engine: 'tengine-vision' });
    expect(r.success).toBe(true);
    expect(r.engine).toBe('rapid-ocr');
    expect(r.fallbackFrom).toBe('tengine-vision');
    expect(r.fallbackReason).toBe('unavailable');
    expect(recognizeMock).not.toHaveBeenCalled();
    expect(windowsMock).not.toHaveBeenCalled();
  });

  it('falls through to Windows OCR when PP-OCR reads nothing and the vision model is off', async () => {
    configureRuntime({ localLlm: llm({ usable: false }) });
    useLocal({ paddle: async () => ({ success: true, text: '', blocks: [], rawBlocks: [] }) });
    const manager = await makeManager();
    const r = await manager.recognize(IMG, { engine: 'tengine-vision' });
    expect(r.engine).toBe('windows-ocr');
    expect(r.fallbackFrom).toBe('tengine-vision');
  });
});

describe('the routing log line', () => {
  const logged = [];
  const capture = (level) => (...args) => logged.push(`${level} ${args.join(' ')}`);
  const routingLines = () => logged.filter((l) => l.includes('vision routing:'));

  beforeEach(() => {
    logged.length = 0;
    configureRuntime({
      loggerFactory: () => ({ debug: () => {}, info: capture('info'), warn: capture('warn'), error: capture('error'), success: capture('info') }),
    });
  });

  it('writes one line per capture, with the numbers and both timings', async () => {
    configureRuntime({ localLlm: llm() });
    useLocal({ paddle: async () => TABLE });
    const manager = await makeManager();
    await manager.recognize(IMG, { engine: 'tengine-vision' });

    expect(routingLines()).toHaveLength(1);
    expect(routingLines()[0]).toMatch(
      /^info vision routing: to=tengine-vision reason=table mp=null lines=12 conf=0\.98 low=0 rows=4 cols=3 spread=1 pp=\d+ms vision=\d+ms$/
    );
  });

  it('also records the captures that stay on PP-OCR', async () => {
    configureRuntime({ localLlm: llm() });
    const manager = await makeManager();
    await manager.recognize(IMG, { engine: 'tengine-vision' });

    expect(routingLines()).toHaveLength(1);
    expect(routingLines()[0]).toMatch(/to=rapid-ocr reason=simple .* lines=2 .* pp=\d+ms$/);
  });

  it('marks a vision failure on the same line', async () => {
    configureRuntime({ localLlm: llm({ reject: Object.assign(new Error('host stalled'), { code: 'LLM_UNHEALTHY' }) }) });
    useLocal({ paddle: async () => TABLE });
    const manager = await makeManager();
    await manager.recognize(IMG, { engine: 'tengine-vision' });

    expect(routingLines()).toHaveLength(1);
    expect(routingLines()[0]).toMatch(/to=rapid-ocr reason=table .* visionFailed$/);
  });

  it('never contains what was read', async () => {
    configureRuntime({ localLlm: llm({ lines: [{ text: 'VISION-SECRET', box: [45, 19, 91, 45] }] }) });
    useLocal({ paddle: async () => TABLE });
    const manager = await makeManager();
    await manager.recognize(IMG, { engine: 'tengine-vision' });

    const all = logged.join('\n');
    expect(all).not.toContain('VISION-SECRET');
    expect(all).not.toContain('cell00');
  });
});
