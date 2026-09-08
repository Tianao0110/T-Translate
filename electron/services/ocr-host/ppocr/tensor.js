// RGBA pixels -> planar float32 [3, H, W] for the PP-OCR graphs. Plane order
// is blue, green, red, each normalised with its own mean/std — the layout
// the upstream pipeline fed the models, kept so results stay identical.
// Written straight into the Float32Array: no nested arrays, no flatten.
function normalizeCHW(image, mean, std) {
  const { data, width, height } = image;
  const plane = width * height;
  const out = new Float32Array(plane * 3);
  const g = plane;
  const r = plane * 2;
  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    out[p] = (data[i + 2] / 255 - mean[2]) / std[2];
    out[g + p] = (data[i + 1] / 255 - mean[1]) / std[1];
    out[r + p] = (data[i] / 255 - mean[0]) / std[0];
  }
  return out;
}

module.exports = { normalizeCHW };
