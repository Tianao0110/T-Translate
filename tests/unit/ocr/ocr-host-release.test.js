// OCR host session lifetime (electron/services/ocr-host/ocr-host.js): a
// session dropped from the cache (LRU, evict, provider switch) is released
// at once, or after the request still running on it; CPU sessions run
// without onnxruntime's memory arena.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const HOST_DIR = path.resolve(__dirname, '../../../electron/services/ocr-host');

const made = []; // { det, opt, released, finish? }
const DICT = path.join(os.tmpdir(), `tt-ocr-host-dict-${process.pid}.txt`);
let holdNext = false;

function fakeModule(file, exports) {
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let onMessage;
const posted = [];

beforeAll(() => {
  fs.writeFileSync(DICT, 'a\n');
  fakeModule(require.resolve(path.join(HOST_DIR, 'ppocr')), {
    createOcr: async ({ ortOption, det }) => {
      const s = { det, opt: ortOption, released: 0 };
      s.release = async () => { s.released++; };
      s.ocr = () => {
        if (!holdNext) return Promise.resolve({ src: [], parragraphs: [] });
        holdNext = false;
        return new Promise((resolve) => { s.finish = () => resolve({ src: [], parragraphs: [] }); });
      };
      made.push(s);
      return s;
    },
  });
  fakeModule(require.resolve(path.join(HOST_DIR, 'layout')), { createLayout: async () => ({ analyze: async () => [], release: async () => {} }) });
  fakeModule(require.resolve('onnxruntime-node', { paths: [HOST_DIR] }), {});
  fakeModule(require.resolve('@napi-rs/canvas', { paths: [HOST_DIR] }), {
    loadImage: async () => ({ width: 4, height: 4 }),
    createCanvas: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({}) }) }),
  });
  process.parentPort = {
    postMessage: (m) => posted.push(m),
    on: (event, fn) => { if (event === 'message') onMessage = fn; },
  };
  require(path.join(HOST_DIR, 'ocr-host.js'));
});

let nextId = 1;
const send = (msg) => onMessage({ data: msg });
const tick = () => new Promise((r) => setTimeout(r, 0));

async function recognize(packId) {
  const id = nextId++;
  send({ type: 'recognize', id, packId, models: { det: `det-${packId}`, rec: 'r', dict: DICT, gen: 'v6' }, image: 'data:image/png;base64,AA==' });
  for (let i = 0; i < 50 && !posted.some((m) => m.id === id); i++) await tick();
  return posted.find((m) => m.id === id);
}

const sessionFor = (packId) => made.filter((s) => s.det === `det-${packId}`).at(-1);

beforeEach(async () => {
  send({ type: 'evict' });
  send({ type: 'init', provider: 'cpu' });
  await tick();
  made.length = 0;
});

describe('OCR host session lifetime', () => {
  it('CPU sessions run without the memory arena', async () => {
    await recognize('base-v6');
    expect(sessionFor('base-v6').opt).toEqual({ enableCpuMemArena: false });
  });

  it('the least recently used session is released when a third pack loads', async () => {
    await recognize('a');
    await recognize('b');
    await recognize('c');
    expect(sessionFor('a').released).toBe(1);
    expect(sessionFor('b').released).toBe(0);
    expect(sessionFor('c').released).toBe(0);
  });

  it('evict releases one pack or every session', async () => {
    await recognize('a');
    await recognize('b');
    send({ type: 'evict', packId: 'a' });
    await tick();
    expect(sessionFor('a').released).toBe(1);
    expect(sessionFor('b').released).toBe(0);
    send({ type: 'evict' });
    await tick();
    expect(sessionFor('b').released).toBe(1);
  });

  it('a session dropped mid-request is released only after that request', async () => {
    await recognize('a');
    holdNext = true;
    const pending = recognize('a');
    await tick();
    send({ type: 'evict' });
    await tick();
    expect(sessionFor('a').released).toBe(0);
    sessionFor('a').finish();
    expect((await pending).ok).toBe(true);
    await tick();
    expect(sessionFor('a').released).toBe(1);
  });

  it('switching provider releases the old sessions', async () => {
    await recognize('a');
    send({ type: 'set-provider', provider: 'webgpu' });
    await tick();
    expect(sessionFor('a').released).toBe(1);
    send({ type: 'set-provider', provider: 'cpu' });
  });
});
