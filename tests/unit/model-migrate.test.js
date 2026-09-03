// Moving packs out of userData: the old copy must survive anything that goes
// wrong, and a pack downloaded again after the move must not be overwritten.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { scanLegacy, migrateLegacy } = require('../../electron/utils/model-migrate.js');

let base;
const legacy = () => path.join(base, 'legacy');
const active = () => path.join(base, 'active');

function writePack(root, family, name, files) {
  const dir = path.join(root, family, name);
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id: name }));
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-migrate-'));
  fs.mkdirSync(active(), { recursive: true });
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('scanLegacy', () => {
  it('lists packs per family with their size and whether the active root has them', () => {
    writePack(legacy(), 'asr-models', 'sense-voice', { 'model.bin': 'abcdef', 'sub/x': 'gh' });
    writePack(legacy(), 'ocr-models', 'korean', { 'rec.onnx': '1234' });
    writePack(active(), 'ocr-models', 'korean', { 'rec.onnx': '1234' });
    // No pack.json: not a pack, not touched.
    fs.mkdirSync(path.join(legacy(), 'tts-models', 'half-download'), { recursive: true });

    const scan = scanLegacy({ legacyRoot: legacy(), activeRoot: active() });

    // Sizes include pack.json itself: it travels with the pack.
    const meta = (id) => JSON.stringify({ id }).length;
    expect(scan.packs.map((p) => [p.family, p.name, p.bytes, p.duplicate])).toEqual([
      ['ocr-models', 'korean', 4 + meta('korean'), true],
      ['asr-models', 'sense-voice', 8 + meta('sense-voice'), false],
    ]);
    expect(scan.bytes).toBe(scan.packs[0].bytes + scan.packs[1].bytes);
  });

  it('is empty when both roots are the same place', () => {
    writePack(legacy(), 'asr-models', 'sense-voice', { 'model.bin': 'x' });
    expect(scanLegacy({ legacyRoot: legacy(), activeRoot: legacy() })).toEqual({ packs: [], bytes: 0 });
  });
});

describe('migrateLegacy', () => {
  it('moves packs, removes duplicates and reports byte progress', async () => {
    writePack(legacy(), 'asr-models', 'sense-voice', { 'model.bin': 'abcdef', 'sub/x': 'gh' });
    writePack(legacy(), 'ocr-models', 'korean', { 'rec.onnx': 'old' });
    writePack(active(), 'ocr-models', 'korean', { 'rec.onnx': 'new!' });
    const progress = [];

    const result = await migrateLegacy({
      legacyRoot: legacy(),
      activeRoot: active(),
      onProgress: (p) => progress.push(p),
    });

    expect(result).toMatchObject({ moved: 1, removed: 1 });
    expect(fs.readFileSync(path.join(active(), 'asr-models', 'sense-voice', 'model.bin'), 'utf8')).toBe('abcdef');
    expect(fs.readFileSync(path.join(active(), 'asr-models', 'sense-voice', 'sub', 'x'), 'utf8')).toBe('gh');
    // The newer download wins; the old copy is simply gone.
    expect(fs.readFileSync(path.join(active(), 'ocr-models', 'korean', 'rec.onnx'), 'utf8')).toBe('new!');
    expect(fs.existsSync(path.join(legacy(), 'asr-models'))).toBe(false);
    expect(fs.existsSync(path.join(legacy(), 'ocr-models'))).toBe(false);
    const last = progress[progress.length - 1];
    expect(last.done).toBe(last.total);
    expect(result.bytes).toBe(last.total);
  });

  it('keeps the legacy pack and discards the partial copy when a file fails', async () => {
    writePack(legacy(), 'tts-models', 'kokoro', { 'a.onnx': 'aaaa', 'b.onnx': 'bbbb' });
    let calls = 0;

    await expect(migrateLegacy({
      legacyRoot: legacy(),
      activeRoot: active(),
      copyFile: async (from, to) => {
        if (++calls === 2) throw new Error('disk full');
        await fs.promises.copyFile(from, to);
      },
    })).rejects.toThrow('disk full');

    expect(fs.existsSync(path.join(legacy(), 'tts-models', 'kokoro', 'pack.json'))).toBe(true);
    expect(fs.existsSync(path.join(legacy(), 'tts-models', 'kokoro', 'b.onnx'))).toBe(true);
    expect(fs.existsSync(path.join(active(), 'tts-models', 'kokoro'))).toBe(false);
  });

  it('refuses a size mismatch rather than deleting the source', async () => {
    writePack(legacy(), 'ocr-models', 'tamil', { 'rec.onnx': 'xyz' });

    await expect(migrateLegacy({
      legacyRoot: legacy(),
      activeRoot: active(),
      // Writes a truncated copy: the source must stay.
      copyFile: async (from, to) => fs.promises.writeFile(to, 'x'),
    })).rejects.toThrow('size mismatch');

    expect(fs.existsSync(path.join(legacy(), 'ocr-models', 'tamil', 'rec.onnx'))).toBe(true);
    expect(fs.existsSync(path.join(active(), 'ocr-models', 'tamil'))).toBe(false);
  });
});
