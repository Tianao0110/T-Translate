// Binary-map geometry for DB post-processing: connected components on a
// flat Uint8Array and the minimum-area rotated rectangle of a point set.

// 8-connected components; each comes back as its boundary pixels (a
// foreground pixel with a background 4-neighbour inside the image), which
// is all the rotated rectangle needs. Holes never spawn boxes of their own.
function findComponents(bit, width, height) {
  const n = width * height;
  const label = new Int32Array(n);
  const queue = new Int32Array(n);
  const comps = [];
  for (let start = 0; start < n; start++) {
    if (bit[start] === 0 || label[start] !== 0) continue;
    const id = comps.length + 1;
    const points = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const idx = queue[head++];
      const x = idx % width;
      const y = (idx - x) / width;
      if (
        (y > 0 && bit[idx - width] === 0) ||
        (y < height - 1 && bit[idx + width] === 0) ||
        (x > 0 && bit[idx - 1] === 0) ||
        (x < width - 1 && bit[idx + 1] === 0)
      ) {
        points.push({ x, y });
      }
      const y0 = y > 0 ? y - 1 : y;
      const y1 = y < height - 1 ? y + 1 : y;
      const x0 = x > 0 ? x - 1 : x;
      const x1 = x < width - 1 ? x + 1 : x;
      for (let ny = y0; ny <= y1; ny++) {
        for (let nx = x0; nx <= x1; nx++) {
          const m = ny * width + nx;
          if (bit[m] !== 0 && label[m] === 0) {
            label[m] = id;
            queue[tail++] = m;
          }
        }
      }
    }
    if (points.length) comps.push(points);
  }
  return comps;
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Andrew's monotone chain.
function convexHull(points) {
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const lower = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Rotating calipers over the hull edges. Width >= height, angle in [0, 180)
// as OpenCV reports it.
function minAreaRect(contour) {
  if (contour.length === 0) throw new Error('minAreaRect: empty contour');
  const hull = convexHull([...contour]);
  let minArea = Number.POSITIVE_INFINITY;
  const result = { center: { x: 0, y: 0 }, size: { width: 0, height: 0 }, angle: 0 };
  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];
    const ex = p2.x - p1.x;
    const ey = p2.y - p1.y;
    const length = Math.hypot(ex, ey);
    const dx = ex / length;
    const dy = ey / length;
    let minVal = Number.POSITIVE_INFINITY;
    let maxVal = Number.NEGATIVE_INFINITY;
    let minPerp = Number.POSITIVE_INFINITY;
    let maxPerp = Number.NEGATIVE_INFINITY;
    for (const p of hull) {
      const proj = (p.x - p1.x) * dx + (p.y - p1.y) * dy;
      minVal = Math.min(minVal, proj);
      maxVal = Math.max(maxVal, proj);
      const perp = -(p.x - p1.x) * dy + (p.y - p1.y) * dx;
      minPerp = Math.min(minPerp, perp);
      maxPerp = Math.max(maxPerp, perp);
    }
    const area = (maxVal - minVal) * (maxPerp - minPerp);
    if (area < minArea) {
      minArea = area;
      const centerProj = (minVal + maxVal) / 2;
      const centerPerp = (minPerp + maxPerp) / 2;
      result.center = {
        x: p1.x + dx * centerProj - dy * centerPerp,
        y: p1.y + dy * centerProj + dx * centerPerp,
      };
      result.size = { width: maxVal - minVal, height: maxPerp - minPerp };
      result.angle = Math.atan2(dy, dx) * (180 / Math.PI);
    }
  }
  if (result.size.width < result.size.height) {
    [result.size.width, result.size.height] = [result.size.height, result.size.width];
    result.angle += 90;
  }
  result.angle = ((result.angle % 180) + 180) % 180;
  return result;
}

module.exports = { findComponents, minAreaRect };
