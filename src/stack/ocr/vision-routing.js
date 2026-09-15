// Which captures the built-in vision model should take (user rule
// 2026-09-14): PP-OCR reads every capture first, and a simple one stops
// there. Only a large capture, a layout PP-OCR read as columns / a table /
// mixed font sizes, or a read it was unsure of goes on to the vision model.
// PP-OCR's own line boxes and confidences are the evidence; nothing here
// looks at pixels beyond the image header.

import { isUsableResult } from './result-quality.js';

export const ROUTING = {
  // Physical pixels: a full-screen or half-screen capture on a 1.75x display.
  LARGE_PIXELS: 1200000,
  MANY_LINES: 30,
  // Layout tests need enough lines to mean anything.
  MIN_LINES_FOR_LAYOUT: 8,
  LOW_CONFIDENCE: 0.75,
  LOW_LINE_CONFIDENCE: 0.6,
  LOW_LINE_SHARE: 0.3,
  TABLE_ROWS: 3,
  TABLE_COLS: 3,
  COLUMN_MIN_LINES: 4,
  SIZE_SPREAD: 2.5,
};

function bytesOf(input) {
  // isView rather than instanceof: a Buffer from another realm (the
  // renderer's test environment) is still bytes.
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input !== 'string') return null;
  const comma = input.startsWith('data:') ? input.indexOf(',') : -1;
  try {
    return Buffer.from(comma >= 0 ? input.slice(comma + 1) : input, 'base64');
  } catch {
    return null;
  }
}

// Width and height from the file header alone: PNG, JPEG or BMP; null for
// anything else.
export function imageSize(input) {
  const b = bytesOf(input);
  if (!b || b.length < 26) return null;
  const be32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const le32 = (o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: be32(16), height: be32(20) };
  }
  if (b[0] === 0x42 && b[1] === 0x4d) {
    const h = le32(22);
    return { width: le32(18), height: h > 0x7fffffff ? 0x100000000 - h : h };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = b[o + 1];
      if (marker === 0xff) {
        o++;
        continue;
      }
      const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (sof) return { height: (b[o + 5] << 8) | b[o + 6], width: (b[o + 7] << 8) | b[o + 8] };
      if (marker === 0xd9 || marker === 0xda) break;
      o += 2 + ((b[o + 2] << 8) | b[o + 3]);
    }
  }
  return null;
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, c) => a - c);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, c) => a - c);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};

// Groups boxes whose centres sit within `tol` on the given axis.
function cluster(values, tol) {
  const sorted = values.map((v, i) => ({ v, i })).sort((a, c) => a.v - c.v);
  const groups = [];
  for (const { v, i } of sorted) {
    const g = groups[groups.length - 1];
    if (g && v - g.last <= tol) {
      g.items.push(i);
      g.last = v;
    } else {
      groups.push({ items: [i], last: v, first: v });
    }
  }
  return groups.map((g) => g.items);
}

function layoutReason(lines) {
  if (lines.length < ROUTING.MIN_LINES_FOR_LAYOUT) return null;
  const heights = lines.map((l) => l.bbox.height);
  const h = median(heights) || 1;

  // A table: several rows that each hold three or more boxes side by side.
  const rows = cluster(lines.map((l) => l.bbox.y + l.bbox.height / 2), h * 0.6);
  const wideRows = rows.filter((r) => r.length >= ROUTING.TABLE_COLS).length;
  if (wideRows >= ROUTING.TABLE_ROWS) return 'table';

  // Columns: two or more groups of left edges, each a real column of lines,
  // and the groups overlap vertically (side by side, not one under the other).
  const cols = cluster(lines.map((l) => l.bbox.x), h).filter((c) => c.length >= ROUTING.COLUMN_MIN_LINES);
  if (cols.length >= 2) {
    const span = (c) => {
      const ys = c.map((i) => lines[i].bbox.y);
      const bottoms = c.map((i) => lines[i].bbox.y + lines[i].bbox.height);
      return [Math.min(...ys), Math.max(...bottoms)];
    };
    const [a, b] = [span(cols[0]), span(cols[1])];
    const overlap = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
    if (overlap > 0.5 * Math.min(a[1] - a[0], b[1] - b[0])) return 'columns';
  }

  // Headings, captions and body text together: the tallest or the smallest
  // line far from the typical one (a single heading over a paragraph counts).
  const spread = Math.max(percentile(heights, 1) / h, h / Math.max(1, percentile(heights, 0)));
  if (spread >= ROUTING.SIZE_SPREAD) return 'mixed-sizes';
  return null;
}

// null = PP-OCR's read stands; otherwise { reason } naming what sends the
// capture on to the vision model.
export function decideEscalation(pp, size = null) {
  if (!pp || !pp.success || !isUsableResult(pp, 'rapid-ocr')) return { reason: 'unreadable' };
  if (size && size.width * size.height >= ROUTING.LARGE_PIXELS) return { reason: 'large' };
  const lines = (pp.rawBlocks || pp.blocks || []).filter((b) => b && b.bbox && b.bbox.width > 0 && b.bbox.height > 0);
  if (lines.length >= ROUTING.MANY_LINES) return { reason: 'dense' };

  const confs = lines.map((l) => l.confidence).filter((c) => Number.isFinite(c));
  if (confs.length) {
    const mean = confs.reduce((a, c) => a + c, 0) / confs.length;
    const low = confs.filter((c) => c < ROUTING.LOW_LINE_CONFIDENCE).length / confs.length;
    if (mean < ROUTING.LOW_CONFIDENCE || low >= ROUTING.LOW_LINE_SHARE) return { reason: 'low-confidence' };
  }

  const layout = layoutReason(lines);
  return layout ? { reason: layout } : null;
}
