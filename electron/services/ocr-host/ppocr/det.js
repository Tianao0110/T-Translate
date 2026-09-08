// DB text detection: resize to a multiple of 32, run the model, threshold
// the probability map, turn every connected region into a min-area
// rectangle (unclipped by 1.5), crop it upright and estimate its colours.
// Same steps and constants as upstream esearch-ocr; the per-pixel work
// runs on flat typed arrays instead of nested arrays and string keys.
const { normalizeCHW } = require('./tensor');
const { findComponents, minAreaRect } = require('./cv');
const { resizeImg, data2canvas, cropQuad } = require('./image');

const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];
const BIN_THRESHOLD = 0.3;
const UNCLIP_RATIO = 1.5;
const MIN_SIZE = 3;
const COLOR_APART = 100;
const EDGE_NEAR = 200;

function int(n) {
  return n > 0 ? Math.floor(n) : Math.ceil(n);
}

function clip(n, min, max) {
  return Math.max(min, Math.min(n, max));
}

function polygonArea(polygon) {
  let i = -1;
  const n = polygon.length;
  let a;
  let b = polygon[n - 1];
  let area = 0;
  while (++i < n) {
    a = b;
    b = polygon[i];
    area += a[1] * b[0] - a[0] * b[1];
  }
  return area / 2;
}

function polygonLength(polygon) {
  let i = -1;
  const n = polygon.length;
  let b = polygon[n - 1];
  let xa;
  let ya;
  let xb = b[0];
  let yb = b[1];
  let perimeter = 0;
  while (++i < n) {
    xa = xb;
    ya = yb;
    b = polygon[i];
    xb = b[0];
    yb = b[1];
    xa -= xb;
    ya -= yb;
    perimeter += Math.hypot(xa, ya);
  }
  return perimeter;
}

// Push each corner outwards along both of its edges by area/perimeter *
// ratio — the DB "unclip" that grows the shrunk text kernel back to the
// full glyph extent.
function unclip(box) {
  const area = Math.abs(polygonArea(box));
  const length = polygonLength(box);
  const distance = (area * UNCLIP_RATIO) / length;
  const expanded = [];
  for (let i = 0; i < box.length; i++) {
    const p = box[i];
    const last = box.at((i - 1) % 4);
    const next = box.at((i + 1) % 4);
    const x1 = p[0] - last[0];
    const y1 = p[1] - last[1];
    const d1 = Math.sqrt(x1 ** 2 + y1 ** 2);
    const dx1 = (x1 / d1) * distance;
    const dy1 = (y1 / d1) * distance;
    const x2 = p[0] - next[0];
    const y2 = p[1] - next[1];
    const d2 = Math.sqrt(x2 ** 2 + y2 ** 2);
    const dx2 = (x2 / d2) * distance;
    const dy2 = (y2 / d2) * distance;
    expanded.push([p[0] + dx1 + dx2, p[1] + dy1 + dy2]);
  }
  const v1 = [expanded[0][0] - expanded[1][0], expanded[0][1] - expanded[1][1]];
  const v2 = [expanded[2][0] - expanded[1][0], expanded[2][1] - expanded[1][1]];
  return { points: expanded, sside: Math.abs(v1[0] * v2[1] - v1[1] * v2[0]) };
}

function boxPoints(center, size, angle) {
  const theta = (angle * Math.PI) / 180.0;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const cx = center.x;
  const cy = center.y;
  const dx = size.width * 0.5;
  const dy = size.height * 0.5;
  return [
    [cx - dx * cosT + dy * sinT, cy - dx * sinT - dy * cosT],
    [cx + dx * cosT + dy * sinT, cy + dx * sinT - dy * cosT],
    [cx + dx * cosT - dy * sinT, cy + dx * sinT + dy * cosT],
    [cx - dx * cosT - dy * sinT, cy - dx * sinT + dy * cosT],
  ];
}

function getMiniBoxes(contour) {
  const rect = minAreaRect(contour);
  const points = boxPoints(rect.center, rect.size, rect.angle).sort((a, b) => a[0] - b[0]);
  let i1;
  let i2;
  let i3;
  let i4;
  if (points[1][1] > points[0][1]) {
    i1 = 0;
    i4 = 1;
  } else {
    i1 = 1;
    i4 = 0;
  }
  if (points[3][1] > points[2][1]) {
    i2 = 2;
    i3 = 3;
  } else {
    i2 = 3;
    i3 = 2;
  }
  return {
    points: [points[i1], points[i2], points[i3], points[i4]],
    sside: Math.min(rect.size.height, rect.size.width),
  };
}

function linalgNorm(p0, p1) {
  return Math.sqrt((p0[0] - p1[0]) ** 2 + (p0[1] - p1[1]) ** 2);
}

// Returns the same point arrays re-ordered (top-left, top-right,
// bottom-right, bottom-left); callers rely on the shared references.
function orderPointsClockwise(pts) {
  const rect = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  const s = pts.map((pt) => pt[0] + pt[1]);
  rect[0] = pts[s.indexOf(Math.min(...s))];
  rect[2] = pts[s.indexOf(Math.max(...s))];
  const tmp = pts.filter((pt) => pt !== rect[0] && pt !== rect[2]);
  const diff = tmp[1].map((e, i) => e - tmp[0][i]);
  rect[1] = tmp[diff.indexOf(Math.min(...diff))];
  rect[3] = tmp[diff.indexOf(Math.max(...diff))];
  return rect;
}

function colorDistance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function weightedAverage(pairs) {
  const sum = pairs.map((i) => i[1]).reduce((a, b) => a + b, 0);
  let n = 0;
  for (const i of pairs) n += (i[0] * i[1]) / sum;
  return n;
}

// Dominant colour = background, runner-up = text edge; when those are too
// close, the text colour is the count-weighted mean of the remaining
// distinct colours, or the inverse of the background as a last resort.
// Only the left 4*height columns of the crop are sampled, as upstream.
function getImgColor(img) {
  const { data, width, height } = img;
  const hist = new Map();
  const maxX = Math.min(width - 1, height * 4);
  for (let y = 0; y < height; y++) {
    let i = y * width * 4;
    for (let x = 0; x <= maxX; x++, i += 4) {
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      hist.set(key, (hist.get(key) || 0) + 1);
    }
  }
  const top = [...hist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([key, count]) => ({ el: [(key >> 16) & 255, (key >> 8) & 255, key & 255], count }));
  const bg = top[0]?.el ?? [255, 255, 255];
  const textEdge = top[1]?.el ?? [0, 0, 0];
  let text = textEdge;
  if (colorDistance(textEdge, bg) < COLOR_APART) {
    const split = top.slice(1).filter((c) => colorDistance(c.el, bg) > 50);
    if (split.length > 0) {
      text = [0, 1, 2].map((i) => Math.round(weightedAverage(split.map((c) => [c.el[i], c.count]))));
    }
    if (split.length === 0 || colorDistance(text, bg) < COLOR_APART) text = bg.map((x) => 255 - x);
  }
  return { bg, text, textEdge };
}

// Shrink the box by the blank margin (up to 4 px a side) between the crop
// edge and the first pixel close to the text colour.
function matchBestBox(box, img, edge) {
  const { data, width, height } = img;
  const near = (i) =>
    Math.sqrt((data[i] - edge[0]) ** 2 + (data[i + 1] - edge[1]) ** 2 + (data[i + 2] - edge[2]) ** 2) < EDGE_NEAR;
  let top = 0;
  let bottom = height;
  let left = 0;
  let right = width;
  yt: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (near((y * width + x) * 4)) {
        top = y;
        break yt;
      }
    }
  }
  yb: for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if (near((y * width + x) * 4)) {
        bottom = y;
        break yb;
      }
    }
  }
  xl: for (let x = 0; x < width; x++) {
    for (let y = top; y <= bottom; y++) {
      if (near((y * width + x) * 4)) {
        left = x;
        break xl;
      }
    }
  }
  xr: for (let x = width - 1; x >= 0; x--) {
    for (let y = top; y <= bottom; y++) {
      if (near((y * width + x) * 4)) {
        right = x;
        break xr;
      }
    }
  }
  const dyT = clip(top - 1, 0, 4);
  const dyB = clip(height - bottom - 1, 0, 4);
  const dxL = clip(left - 1, 0, 4);
  const dxR = clip(width - right - 1, 0, 4);
  return [
    [box[0][0] + dxL, box[0][1] + dyT],
    [box[1][0] - dxR, box[1][1] + dyT],
    [box[2][0] - dxR, box[2][1] - dyB],
    [box[3][0] + dxL, box[3][1] - dyB],
  ];
}

function afterDet(prob, width, height, resizeW, resizeH, src) {
  // "fill" resize: a source smaller than the model input keeps its size,
  // so the map-to-source scale is taken against the smaller extent.
  const w = Math.min(src.width, resizeW);
  const h = Math.min(src.height, resizeH);
  const rx = src.width / w;
  const ry = src.height / h;
  const bit = new Uint8Array(width * height);
  for (let i = 0; i < bit.length; i++) bit[i] = prob[i] > BIN_THRESHOLD ? 1 : 0;

  let srcCanvas = null;
  const boxes = [];
  for (const contour of findComponents(bit, width, height)) {
    const mini = getMiniBoxes(contour);
    if (mini.sside < MIN_SIZE) continue;
    const grown = unclip(mini.points);
    if (grown.sside < MIN_SIZE + 2) continue;
    const box = grown.points;
    for (const p of box) {
      p[0] *= rx;
      p[1] *= ry;
    }
    const ordered = orderPointsClockwise(box);
    for (const p of ordered) {
      p[0] = clip(Math.round(p[0]), 0, src.width);
      p[1] = clip(Math.round(p[1]), 0, src.height);
    }
    if (int(linalgNorm(ordered[0], ordered[1])) <= 3 || int(linalgNorm(ordered[0], ordered[3])) <= 3) continue;
    if (!srcCanvas) srcCanvas = data2canvas(src);
    const crop = cropQuad(srcCanvas, box);
    const { bg, text } = getImgColor(crop);
    boxes.push({ box: matchBestBox(box, crop, text), img: crop, style: { bg, text } });
  }
  return boxes;
}

function createDet({ ort, session, ratio = 1 }) {
  async function det(src) {
    const resizeH = Math.max(Math.round((src.height * ratio) / 32) * 32, 32);
    const resizeW = Math.max(Math.round((src.width * ratio) / 32) * 32, 32);
    const image = resizeImg(src, resizeW, resizeH, 'fill');
    const input = new ort.Tensor('float32', normalizeCHW(image, DET_MEAN, DET_STD), [1, 3, resizeH, resizeW]);
    const out = await session.run({ [session.inputNames[0]]: input });
    const prob = out[session.outputNames[0]];
    return afterDet(prob.data, prob.dims[3], prob.dims[2], resizeW, resizeH, src);
  }
  return { det };
}

module.exports = { createDet };
