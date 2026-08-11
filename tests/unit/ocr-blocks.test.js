// Coordinate parsing for the engines that report boxes.
//
// Six of seven OCR engines used to drop position data on the floor, which left
// the floating window's scattered mode working only under the local PP-OCR
// engine. Each parser here is fed the documented response shape of its API.
// Only Windows OCR and the local engine can be verified end-to-end on a dev
// box — the online four are fixture-verified, so the shapes below ARE the
// spec they were written against.

import { describe, it, expect, vi } from 'vitest';
import { rectFromPoints, unionRects, makeBlocks } from '../../src/stack/ocr/blocks.js';
import { coordsFitFrame, resolveDisplayMode, shouldUseScatteredMode } from '../../src/services/display-mode.js';
import { configureRuntime } from '../../src/stack/runtime.js';
import AzureOCREngine from '../../src/stack/ocr/azure-ocr.js';
import GoogleVisionEngine from '../../src/stack/ocr/google-vision.js';
import OCRSpaceEngine from '../../src/stack/ocr/ocrspace.js';
import BaiduOCREngine from '../../src/stack/ocr/baidu-ocr.js';
import windowsOcr from '../../electron/utils/windows-ocr.js';

const { parseRecognizeOutput } = windowsOcr;

const IMG = 'data:image/png;base64,AAAA';

// Routes by URL so multi-request engines (Azure submit+poll, Baidu token+OCR)
// can be driven from one table.
function routedFetch(routes) {
  return vi.fn(async (url) => {
    const match = Object.keys(routes).find(k => String(url).includes(k));
    if (!match) throw new Error(`unmocked URL: ${url}`);
    const { status = 200, body, headers = {} } = routes[match];
    return {
      ok: status < 400,
      status,
      headers: { get: (name) => headers[name] ?? null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

describe('rectFromPoints', () => {
  it('reads Azure\'s flat 8-number quadrilateral', () => {
    // [x1,y1, x2,y2, x3,y3, x4,y4] clockwise from top-left
    expect(rectFromPoints([10, 20, 110, 22, 110, 42, 10, 40]))
      .toEqual({ x: 10, y: 20, width: 100, height: 22 });
  });

  it('reads Google Vision\'s vertex objects', () => {
    expect(rectFromPoints([
      { x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 40 }, { x: 10, y: 40 },
    ])).toEqual({ x: 10, y: 20, width: 100, height: 20 });
  });

  it('tolerates Vision omitting x/y at the origin', () => {
    // Vision leaves a 0 coordinate out of the vertex entirely.
    expect(rectFromPoints([{ y: 5 }, { x: 30, y: 5 }, { x: 30, y: 25 }, { y: 25 }]))
      .toEqual({ x: 0, y: 5, width: 30, height: 20 });
  });

  it('rejects malformed input instead of inventing a box', () => {
    for (const bad of [null, undefined, [], [1, 2, 3], [1, 2, 3, 4, 5], [NaN, 0, 1, 1]]) {
      expect(rectFromPoints(bad)).toBeNull();
    }
  });
});

describe('unionRects', () => {
  it('covers a line from its word boxes', () => {
    expect(unionRects([
      { x: 10, y: 20, width: 40, height: 18 },
      { x: 55, y: 22, width: 30, height: 16 },
    ])).toEqual({ x: 10, y: 20, width: 75, height: 18 });
  });

  it('returns null when nothing usable is left', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: NaN, y: 0, width: 1, height: 1 }])).toBeNull();
  });
});

describe('makeBlocks', () => {
  it('indexes surviving blocks consecutively', () => {
    const blocks = makeBlocks([
      { text: 'one', bbox: { x: 0, y: 0, width: 10, height: 5 } },
      { text: '   ', bbox: { x: 0, y: 10, width: 10, height: 5 } }, // blank
      { text: 'two', bbox: null },                                   // no box
      { text: 'three', bbox: { x: 0, y: 20, width: 10, height: 5 } },
    ]);
    expect(blocks.map(b => b.text)).toEqual(['one', 'three']);
    expect(blocks.map(b => b.index)).toEqual([0, 1]);
  });

  it('drops zero-area and non-finite boxes rather than half-placing a pane', () => {
    expect(makeBlocks([
      { text: 'a', bbox: { x: 0, y: 0, width: 0, height: 5 } },
      { text: 'b', bbox: { x: 0, y: 0, width: 5, height: 0 } },
      { text: 'c', bbox: { x: NaN, y: 0, width: 5, height: 5 } },
    ])).toEqual([]);
  });

  it('defaults confidence when the engine reports none', () => {
    const [block] = makeBlocks([{ text: 'x', bbox: { x: 1, y: 2, width: 3, height: 4 } }]);
    expect(block.confidence).toBe(0.9);
  });
});

describe('parsed blocks keep line granularity', () => {
  // Word-level boxes are roughly as tall as they are wide, so feeding them to
  // the heuristic reads as a word pile and forces scattered mode on prose.
  // This is why every parser unions words into lines.
  it('word-shaped boxes would flip prose into scattered mode', () => {
    const words = makeBlocks([
      { text: 'The', bbox: { x: 0, y: 0, width: 30, height: 18 } },
      { text: 'quick', bbox: { x: 35, y: 0, width: 45, height: 18 } },
      { text: 'brown', bbox: { x: 85, y: 0, width: 50, height: 18 } },
      { text: 'fox', bbox: { x: 140, y: 0, width: 28, height: 18 } },
    ]);
    expect(shouldUseScatteredMode(words, { width: 400, height: 100 })).toBe(true);
  });

  it('line-shaped boxes read as one column', () => {
    const lines = makeBlocks([
      { text: 'The quick brown fox', bbox: { x: 0, y: 0, width: 300, height: 18 } },
      { text: 'jumps over the lazy', bbox: { x: 0, y: 20, width: 300, height: 18 } },
      { text: 'dog and keeps going', bbox: { x: 0, y: 40, width: 295, height: 18 } },
      { text: 'until the page ends', bbox: { x: 0, y: 60, width: 298, height: 18 } },
    ]);
    expect(shouldUseScatteredMode(lines, { width: 320, height: 100 })).toBe(false);
  });
});

describe('coordsFitFrame', () => {
  const frame = { width: 400, height: 200 };
  const inside = makeBlocks([{ text: 'a', bbox: { x: 10, y: 10, width: 100, height: 20 } }]);

  it('accepts boxes inside the frame', () => {
    expect(coordsFitFrame(inside, frame)).toBe(true);
  });

  it('accepts a box clipped slightly past the edge', () => {
    const clipped = makeBlocks([{ text: 'a', bbox: { x: 380, y: 190, width: 30, height: 15 } }]);
    expect(coordsFitFrame(clipped, frame)).toBe(true);
  });

  it('rejects a set reported in a 2x coordinate space', () => {
    // The failure mode this guards: a server that upscales the image and
    // reports the overlay in the scaled space.
    const doubled = makeBlocks([{ text: 'a', bbox: { x: 20, y: 20, width: 200, height: 40 } },
                                { text: 'b', bbox: { x: 20, y: 300, width: 200, height: 40 } }]);
    expect(coordsFitFrame(doubled, frame)).toBe(false);
  });

  it('cannot judge without a frame, so it allows', () => {
    expect(coordsFitFrame(inside, null)).toBe(true);
    expect(coordsFitFrame(inside, { width: 0, height: 0 })).toBe(true);
  });
});

describe('resolveDisplayMode with untrusted or missing coordinates', () => {
  const frame = { width: 400, height: 200 };
  const offFrame = makeBlocks([
    { text: 'a', bbox: { x: 20, y: 20, width: 200, height: 40 } },
    { text: 'b', bbox: { x: 20, y: 300, width: 200, height: 40 } },
  ]);

  it('falls back to unified when the boxes cannot be trusted', () => {
    expect(resolveDisplayMode('scattered', offFrame, offFrame, frame))
      .toMatchObject({ useScattered: false, fellBack: true });
  });

  it('flags auto mode too — silently landing on unified reads as a decision', () => {
    // An engine with no coordinates at all (LLM vision, Windows OCR before
    // this change). The badge tooltip explains why scattered never engaged.
    expect(resolveDisplayMode('auto', [], [], frame))
      .toMatchObject({ useScattered: false, fellBack: true });
  });

  it('does not flag a genuine heuristic decision', () => {
    const paragraph = makeBlocks([
      { text: 'line one here', bbox: { x: 0, y: 0, width: 300, height: 18 } },
      { text: 'line two here', bbox: { x: 0, y: 20, width: 300, height: 18 } },
      { text: 'line three ok', bbox: { x: 0, y: 40, width: 295, height: 18 } },
    ]);
    expect(resolveDisplayMode('auto', paragraph, paragraph, frame))
      .toMatchObject({ useScattered: false, fellBack: false });
  });

  it('leaves an explicit unified pick alone', () => {
    expect(resolveDisplayMode('unified', offFrame, offFrame, frame))
      .toMatchObject({ useScattered: false, fellBack: false });
  });
});

// Each fixture mirrors the vendor's documented response. These are the shapes
// the parsers were written against — change one only against the vendor's docs.
describe('engine response parsing', () => {
  it('Azure Read v3.2: line boundingBox quadrilaterals', async () => {
    configureRuntime({
      fetch: routedFetch({
        '/read/analyze': { status: 202, body: {}, headers: { 'Operation-Location': 'https://az/op/1' } },
        '/op/1': {
          body: {
            status: 'succeeded',
            analyzeResult: {
              readResults: [{
                page: 1, width: 400, height: 200,
                lines: [
                  { boundingBox: [10, 20, 110, 22, 110, 42, 10, 40], text: 'Hello world' },
                  { boundingBox: [10, 50, 130, 50, 130, 70, 10, 70], text: 'Second line' },
                ],
              }],
            },
          },
        },
      }),
    });

    const engine = new AzureOCREngine({ apiKey: 'k', endpoint: 'https://az' });
    const result = await engine.recognize(IMG);

    expect(result.success).toBe(true);
    expect(result.text).toBe('Hello world\nSecond line');
    expect(result.rawBlocks).toHaveLength(2);
    expect(result.rawBlocks[0]).toMatchObject({
      text: 'Hello world',
      bbox: { x: 10, y: 20, width: 100, height: 22 },
    });
  });

  it('Google Vision: paragraph boxes rebuilt from symbols, not per-word annotations', async () => {
    configureRuntime({
      fetch: routedFetch({
        'vision.googleapis.com': {
          body: {
            responses: [{
              textAnnotations: [{ description: 'Hi there', locale: 'en' }],
              fullTextAnnotation: {
                pages: [{
                  blocks: [{
                    paragraphs: [{
                      boundingBox: { vertices: [{ x: 5, y: 5 }, { x: 205, y: 5 }, { x: 205, y: 45 }, { x: 5, y: 45 }] },
                      confidence: 0.98,
                      words: [
                        { symbols: [
                          { text: 'H' },
                          { text: 'i', property: { detectedBreak: { type: 'SPACE' } } },
                        ] },
                        { symbols: [
                          { text: 't' }, { text: 'h' }, { text: 'e' }, { text: 'r' },
                          { text: 'e', property: { detectedBreak: { type: 'LINE_BREAK' } } },
                        ] },
                      ],
                    }],
                  }],
                }],
              },
            }],
          },
        },
      }),
    });

    const engine = new GoogleVisionEngine({ apiKey: 'k' });
    const result = await engine.recognize(IMG);

    expect(result.success).toBe(true);
    expect(result.rawBlocks).toHaveLength(1);
    expect(result.rawBlocks[0]).toMatchObject({
      text: 'Hi there',
      bbox: { x: 5, y: 5, width: 200, height: 40 },
      confidence: 0.98,
    });
  });

  it('OCR.space: line box is the union of its word boxes', async () => {
    configureRuntime({
      fetch: routedFetch({
        'api.ocr.space': {
          body: {
            ParsedResults: [{
              ParsedText: 'Hello world',
              TextOverlay: {
                Lines: [{
                  LineText: 'Hello world',
                  Words: [
                    { WordText: 'Hello', Left: 10, Top: 20, Width: 40, Height: 18 },
                    { WordText: 'world', Left: 55, Top: 22, Width: 30, Height: 16 },
                  ],
                }],
              },
            }],
          },
        },
      }),
    });

    const engine = new OCRSpaceEngine({ apiKey: 'k' });
    const result = await engine.recognize(IMG);

    expect(result.success).toBe(true);
    expect(result.rawBlocks).toHaveLength(1);
    expect(result.rawBlocks[0].bbox).toEqual({ x: 10, y: 20, width: 75, height: 18 });
  });

  it('OCR.space: an overlay-less response still returns text, just unpositioned', async () => {
    configureRuntime({
      fetch: routedFetch({
        'api.ocr.space': { body: { ParsedResults: [{ ParsedText: 'no overlay here' }] } },
      }),
    });

    const result = await new OCRSpaceEngine({ apiKey: 'k' }).recognize(IMG);
    expect(result.success).toBe(true);
    expect(result.text).toBe('no overlay here');
    expect(result.rawBlocks).toBeUndefined();
  });

  it('Baidu accurate: per-line location objects', async () => {
    configureRuntime({
      fetch: routedFetch({
        '/oauth/2.0/token': { body: { access_token: 't', expires_in: 2592000 } },
        '/ocr/v1/accurate': {
          body: {
            words_result_num: 2,
            words_result: [
              { words: '第一行', location: { left: 10, top: 20, width: 120, height: 30 } },
              { words: '第二行', location: { left: 10, top: 60, width: 118, height: 30 } },
            ],
          },
        },
      }),
    });

    const engine = new BaiduOCREngine({ apiKey: 'k', secretKey: 's' });
    const result = await engine.recognize(IMG);

    expect(result.success).toBe(true);
    expect(result.rawBlocks).toHaveLength(2);
    expect(result.rawBlocks[1]).toMatchObject({
      text: '第二行',
      bbox: { x: 10, y: 60, width: 118, height: 30 },
    });
  });

  it('Windows OCR: line box is the union of its word rects', () => {
    // Shape emitted by buildRecognizeScript's ConvertTo-Json.
    const { text, blocks } = parseRecognizeOutput(JSON.stringify({
      lines: [
        { text: 'Hello world', words: [
          { x: 10, y: 20, w: 40, h: 18 },
          { x: 55, y: 22, w: 30, h: 16 },
        ] },
        { text: 'Second', words: [{ x: 10, y: 50, w: 60, h: 18 }] },
      ],
    }));

    expect(text).toBe('Hello world\nSecond');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].bbox).toEqual({ x: 10, y: 20, width: 75, height: 18 });
  });

  it('Windows OCR: survives PowerShell collapsing single-element arrays', () => {
    // PS 5.1 renders a one-element array as a bare object.
    const { text, blocks } = parseRecognizeOutput(JSON.stringify({
      lines: { text: 'Only line', words: { x: 5, y: 5, w: 50, h: 12 } },
    }));
    expect(text).toBe('Only line');
    expect(blocks[0].bbox).toEqual({ x: 5, y: 5, width: 50, height: 12 });
  });

  it('Windows OCR: empty and non-JSON output degrade instead of throwing', () => {
    expect(parseRecognizeOutput('')).toEqual({ text: '', blocks: [] });
    expect(parseRecognizeOutput(JSON.stringify({ lines: [] }))).toEqual({ text: '', blocks: [] });
    // A host where ConvertTo-Json misbehaved: keep the text, lose the boxes.
    expect(parseRecognizeOutput('plain text line')).toEqual({ text: 'plain text line', blocks: [] });
  });

  it('Baidu: asks the positioned endpoint first', async () => {
    const fetch = routedFetch({
      '/oauth/2.0/token': { body: { access_token: 't', expires_in: 2592000 } },
      '/ocr/v1/accurate': { body: { words_result: [{ words: 'x', location: { left: 0, top: 0, width: 5, height: 5 } }] } },
    });
    configureRuntime({ fetch });

    await new BaiduOCREngine({ apiKey: 'k', secretKey: 's' }).recognize(IMG);

    const ocrCall = fetch.mock.calls.find(([url]) => String(url).includes('/ocr/v1/'));
    expect(ocrCall[0]).toContain('/ocr/v1/accurate?');
    expect(ocrCall[0]).not.toContain('accurate_basic');
  });

  it('Baidu: an unactivated or exhausted `accurate` drops to basic, text intact', async () => {
    // 6 = interface not activated. The user may only have turned on the
    // no-position endpoint; losing scattered layout beats losing the capture.
    let call = 0;
    const fetch = vi.fn(async (url) => {
      const body = String(url).includes('/oauth/')
        ? { access_token: 't', expires_in: 2592000 }
        : String(url).includes('accurate_basic')
          ? { words_result: [{ words: '仍然有文字' }] }
          : (call++, { error_code: 6, error_msg: 'No permission to access data' });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => '' };
    });
    configureRuntime({ fetch });

    const result = await new BaiduOCREngine({ apiKey: 'k', secretKey: 's' }).recognize(IMG);

    expect(result.success).toBe(true);
    expect(result.text).toBe('仍然有文字');
    expect(result.rawBlocks).toBeUndefined();  // no coordinates from basic
    expect(fetch.mock.calls.some(([u]) => String(u).includes('accurate_basic'))).toBe(true);
  });

  it('Baidu: a genuine error still surfaces instead of silently retrying', async () => {
    const fetch = routedFetch({
      '/oauth/2.0/token': { body: { access_token: 't', expires_in: 2592000 } },
      '/ocr/v1/accurate': { body: { error_code: 216201, error_msg: 'image format error' } },
    });
    configureRuntime({ fetch });

    const result = await new BaiduOCREngine({ apiKey: 'k', secretKey: 's' }).recognize(IMG);
    expect(result.success).toBe(false);
    expect(result.error).toContain('image format error');
    expect(fetch.mock.calls.some(([u]) => String(u).includes('accurate_basic'))).toBe(false);
  });
});
