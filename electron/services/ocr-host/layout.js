// PP-DocLayoutV3 in the OCR host: one page image → layout blocks in reading
// order, each box as fractions of the image. The PDF parser places its text
// lines into them (src/document/pdf-text.js). Model contract and why V3:
// docs/design/ocr.md.

const LABELS = [
  'abstract', 'algorithm', 'aside_text', 'chart', 'content', 'display_formula', 'doc_title',
  'figure_title', 'footer', 'footer_image', 'footnote', 'formula_number', 'header', 'header_image',
  'image', 'inline_formula', 'number', 'paragraph_title', 'reference', 'reference_content', 'seal',
  'table', 'text', 'vertical_text', 'vision_footnote',
];
const SIZE = 800;
const MIN_SCORE = 0.45;

// Output rows → blocks. V3 rows are [class, score, x1, y1, x2, y2, order];
// V2 adds a secondary order key, sorted descending.
function parseRows(data, cols, count, width, height, minScore = MIN_SCORE) {
  const fraction = (value, max) => Math.min(1, Math.max(0, value / max));
  const rows = [];
  for (let r = 0; r < count; r++) {
    const v = data.slice(r * cols, (r + 1) * cols);
    if (!(v[1] >= minScore)) continue;
    const box = [fraction(v[2], width), fraction(v[3], height), fraction(v[4], width), fraction(v[5], height)];
    if (box[2] <= box[0] || box[3] <= box[1]) continue;
    rows.push({ label: LABELS[v[0]] || String(v[0]), score: Math.round(v[1] * 1000) / 1000, box, keyA: v[6], keyB: cols > 7 ? v[7] : 0 });
  }
  rows.sort((a, b) => (a.keyA - b.keyA) || (b.keyB - a.keyB));
  return rows.map(({ label, score, box }, order) => ({ label, score, box, order }));
}

async function createLayout({ ort, ortOption, canvasKit, model }) {
  const session = await ort.InferenceSession.create(model, ortOption);
  const canvas = canvasKit.createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  // Boxes and counts only: the V3 masks (300 × 200 × 200 per page) stay on
  // the device.
  const fetches = session.outputNames.slice(0, 2);

  async function analyze(img) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const plane = SIZE * SIZE;
    const chw = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      chw[i] = rgba[i * 4] / 255;
      chw[plane + i] = rgba[i * 4 + 1] / 255;
      chw[2 * plane + i] = rgba[i * 4 + 2] / 255;
    }
    const feed = { image: new ort.Tensor('float32', chw, [1, 3, SIZE, SIZE]) };
    if (session.inputNames.includes('scale_factor')) {
      feed.scale_factor = new ort.Tensor('float32', Float32Array.from([SIZE / img.height, SIZE / img.width]), [1, 2]);
    }
    if (session.inputNames.includes('im_shape')) {
      feed.im_shape = new ort.Tensor('float32', Float32Array.from([SIZE, SIZE]), [1, 2]);
    }
    const out = await session.run(feed, fetches);
    const preds = out[fetches[0]];
    const [rows, cols] = preds.dims;
    const count = Math.min(rows, Number(out[fetches[1]].data[0]));
    return parseRows(preds.data, cols, count, img.width, img.height);
  }

  return { analyze };
}

module.exports = { createLayout, parseRows, LABELS, MIN_SCORE };
