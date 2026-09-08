// Canvas-backed image helpers for the PP-OCR pipeline. The canvas
// implementation is injected by the host (skia via @napi-rs/canvas) so this
// module has no native requires of its own.

let kit = null;

function setCanvasKit(canvasKit) {
  kit = canvasKit;
}

function newCanvas(w, h) {
  return kit.createCanvas(w, h);
}

function newImageData(data, w, h) {
  return new kit.ImageData(data, w, h);
}

function data2canvas(data, w, h) {
  const c = newCanvas(w || data.width, h || data.height);
  c.getContext('2d').putImageData(data, 0, 0);
  return c;
}

// fill: content smaller than the target keeps its size (blank padding to
// the right/bottom), larger content is scaled down. Otherwise stretched.
function resizeImg(data, w, h, fill, smoothing = 'high') {
  const src = data2canvas(data);
  const out = newCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = smoothing !== false;
  if (smoothing) ctx.imageSmoothingQuality = smoothing;
  if (fill === 'fill') ctx.scale(Math.min(w / data.width, 1), Math.min(h / data.height, 1));
  else ctx.scale(w / data.width, h / data.height);
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

// Multiples of 90 only; the rec model reads horizontal lines, so a tall
// crop is turned on its side before recognition.
function rotateImg(img, angle) {
  const a = ((angle % 360) + 360) % 360;
  if (a === 0) return img;
  if (a !== 90 && a !== 180 && a !== 270) throw new Error('rotateImg: multiples of 90 only');
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const j =
        (a === 90 ? x * h + (h - y - 1) : a === 180 ? w - x - 1 + (h - y - 1) * w : (w - x - 1) * h + y) * 4;
      out[j] = data[i];
      out[j + 1] = data[i + 1];
      out[j + 2] = data[i + 2];
      out[j + 3] = data[i + 3];
    }
  }
  return a === 180 ? newImageData(out, w, h) : newImageData(out, h, w);
}

// Affine crop of a quadrilateral (top-left, top-right, bottom-right,
// bottom-left) into an upright rectangle. `srcCanvas` is the full image
// already on a canvas, shared across boxes so the source is uploaded once.
function cropQuad(srcCanvas, points) {
  const [p0, p1, , p3] = points;
  const width = Math.sqrt((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2);
  const height = Math.sqrt((p3[0] - p0[0]) ** 2 + (p3[1] - p0[1]) ** 2);
  const dx1 = p1[0] - p0[0];
  const dy1 = p1[1] - p0[1];
  const dx3 = p3[0] - p0[0];
  const dy3 = p3[1] - p0[1];
  const det = dx1 * dy3 - dx3 * dy1;
  if (det === 0) throw new Error('cropQuad: degenerate box');
  const a = (width * dy3) / det;
  const c = (-dx3 * width) / det;
  const b = (-height * dy1) / det;
  const d = (dx1 * height) / det;
  const e = -a * p0[0] - c * p0[1];
  const f = -b * p0[0] - d * p0[1];
  const out = newCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = out.getContext('2d');
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(srcCanvas, 0, 0);
  ctx.resetTransform();
  return ctx.getImageData(0, 0, out.width, out.height);
}

module.exports = { setCanvasKit, newCanvas, newImageData, data2canvas, resizeImg, rotateImg, cropQuad };
