// The routing rule between PP-OCR and the built-in vision model: image
// size from headers alone, and the escalation reasons read off PP-OCR's
// own line boxes and confidences.

import { describe, it, expect } from 'vitest';
import { imageSize, decideEscalation, ROUTING } from '../../src/stack/ocr/vision-routing.js';

function png(width, height) {
  const b = Buffer.alloc(33, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function jpeg(width, height) {
  // SOI, an APP0 segment, then SOF0 with the size, then EOI.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(11);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(9, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(20, 0), Buffer.from([0xff, 0xd9])]);
}

function bmp(width, height) {
  const b = Buffer.alloc(54, 0);
  b.write('BM', 0);
  b.writeInt32LE(width, 18);
  b.writeInt32LE(-height, 22);
  return b;
}

// Line boxes in reading order: `rows` lines of `cols` boxes each, with as
// much text as a real line of that shape holds (the quality gate counts
// characters per line-height).
function grid({ rows, cols, x0 = 20, y0 = 20, w = 120, h = 20, gapX = 40, gapY = 12, confidence = 0.98 }) {
  const lines = [];
  const text = 'x'.repeat(Math.ceil(w / h));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      lines.push({ text, confidence, bbox: { x: x0 + c * (w + gapX), y: y0 + r * (h + gapY), width: w, height: h } });
    }
  }
  return lines;
}

const pp = (lines, extra = {}) => ({ success: true, text: lines.map((l) => l.text).join('\n'), blocks: lines, rawBlocks: lines, confidence: 0.98, ...extra });

describe('imageSize', () => {
  it('reads PNG, JPEG and BMP headers from bytes, base64 or a data URL', () => {
    expect(imageSize(png(1463, 914))).toEqual({ width: 1463, height: 914 });
    expect(imageSize(`data:image/png;base64,${png(700, 200).toString('base64')}`)).toEqual({ width: 700, height: 200 });
    expect(imageSize(png(64, 32).toString('base64'))).toEqual({ width: 64, height: 32 });
    expect(imageSize(jpeg(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(imageSize(bmp(800, 600))).toEqual({ width: 800, height: 600 });
    expect(imageSize(Buffer.from('not an image at all, just text bytes here'))).toBeNull();
    expect(imageSize(null)).toBeNull();
  });
});

describe('decideEscalation', () => {
  it('keeps a simple paragraph on PP-OCR', () => {
    expect(decideEscalation(pp(grid({ rows: 5, cols: 1, w: 600 })), { width: 700, height: 200 })).toBeNull();
  });

  it('escalates when PP-OCR failed or read nothing usable', () => {
    expect(decideEscalation({ success: false, error: 'no models' }, null)).toEqual({ reason: 'unreadable' });
    expect(decideEscalation(pp([], { text: '' }), null)).toEqual({ reason: 'unreadable' });
    expect(decideEscalation(pp(grid({ rows: 3, cols: 1 }), { confidence: 0.5 }), null)).toEqual({ reason: 'unreadable' });
  });

  it('escalates a large capture before looking at the layout', () => {
    expect(decideEscalation(pp(grid({ rows: 3, cols: 1 })), { width: 1600, height: 900 })).toEqual({ reason: 'large' });
    expect(decideEscalation(pp(grid({ rows: 3, cols: 1 })), { width: 1000, height: 1000 })).toBeNull();
    expect(ROUTING.LARGE_PIXELS).toBe(1200000);
  });

  it('escalates many lines, a table, columns and mixed font sizes', () => {
    expect(decideEscalation(pp(grid({ rows: 32, cols: 1 })), null)).toEqual({ reason: 'dense' });
    expect(decideEscalation(pp(grid({ rows: 4, cols: 3 })), null)).toEqual({ reason: 'table' });
    // Two columns of prose side by side: five lines each.
    const left = grid({ rows: 5, cols: 1, x0: 20, w: 300 });
    const right = grid({ rows: 5, cols: 1, x0: 400, w: 300 });
    expect(decideEscalation(pp([...left, ...right]), null)).toEqual({ reason: 'columns' });
    // One heading three times the body size over eight body lines.
    const body = grid({ rows: 8, cols: 1, y0: 80, w: 500, h: 16 });
    const heading = [{ text: 'Title', confidence: 0.99, bbox: { x: 20, y: 10, width: 300, height: 48 } }];
    expect(decideEscalation(pp([...heading, ...body]), null)).toEqual({ reason: 'mixed-sizes' });
  });

  it('escalates when PP-OCR was unsure of its own lines', () => {
    const shaky = grid({ rows: 6, cols: 1 }).map((l, i) => ({ ...l, confidence: i < 2 ? 0.5 : 0.9 }));
    expect(decideEscalation(pp(shaky), null)).toEqual({ reason: 'low-confidence' });
    const meh = grid({ rows: 6, cols: 1, confidence: 0.7 });
    expect(decideEscalation(pp(meh), null)).toEqual({ reason: 'low-confidence' });
  });

  it('does not call two stacked columns "columns" and a short list a table', () => {
    const top = grid({ rows: 5, cols: 1, x0: 20, y0: 20, w: 300 });
    const bottom = grid({ rows: 5, cols: 1, x0: 60, y0: 300, w: 300 });
    expect(decideEscalation(pp([...top, ...bottom]), null)).toBeNull();
    expect(decideEscalation(pp(grid({ rows: 2, cols: 3 })), null)).toBeNull();
  });
});
