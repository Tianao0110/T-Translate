// Positioned OCR output, shared by every engine that can report coordinates.
//
// Two contracts the floating window's scattered layout depends on
// (docs/design/stack.md §5):
//   1. Coordinate space is source-image pixels, the capture frame's space.
//   2. Granularity is per line (or per paragraph); engines that only expose
//      words union them into lines first.

// Axis-aligned rect from any polygon shape an OCR API hands back:
// [{x,y},…] vertices, or a flat [x1,y1,x2,y2,…] list.
export function rectFromPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;

  let xs, ys;
  if (typeof points[0] === 'number') {
    if (points.length < 4 || points.length % 2 !== 0) return null;
    xs = points.filter((_, i) => i % 2 === 0);
    ys = points.filter((_, i) => i % 2 === 1);
  } else {
    xs = points.map(p => p?.x ?? 0);
    ys = points.map(p => p?.y ?? 0);
  }

  if (![...xs, ...ys].every(Number.isFinite)) return null;

  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// Bounding rect covering every input rect (word boxes -> line box).
export function unionRects(rects) {
  const valid = (rects || []).filter(
    r => r && Number.isFinite(r.x) && Number.isFinite(r.y) &&
         Number.isFinite(r.width) && Number.isFinite(r.height)
  );
  if (!valid.length) return null;

  const x = Math.min(...valid.map(r => r.x));
  const y = Math.min(...valid.map(r => r.y));
  const right = Math.max(...valid.map(r => r.x + r.width));
  const bottom = Math.max(...valid.map(r => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

// Normalize [{ text, bbox }] into the block shape the pipeline consumes;
// anything without usable text and a usable box is dropped.
export function makeBlocks(items) {
  const blocks = [];
  for (const item of items || []) {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    const b = item?.bbox;
    if (!text || !b) continue;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    if (!(b.width > 0) || !(b.height > 0)) continue;

    blocks.push({
      text,
      confidence: Number.isFinite(item.confidence) ? item.confidence : 0.9,
      bbox: { x: b.x, y: b.y, width: b.width, height: b.height },
      index: blocks.length,
    });
  }
  return blocks;
}
