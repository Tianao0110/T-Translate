// CRNN/SVTR text recognition: each detected crop is laid horizontal,
// resized to the model height, normalised and CTC-decoded. The runner-up
// class per step is kept for the v3/v4 space heuristic.
const { normalizeCHW } = require('./tensor');
const { resizeImg, rotateImg } = require('./image');

const REC_MEAN = [0.5, 0.5, 0.5];
const REC_STD = [0.5, 0.5, 0.5];
const PROB_THRESHOLD = 0.00001;
const LINE_MIN_MEAN = 0.5;

// One entry per line; a trailing newline stands for the space class, and
// a dictionary without one gets it appended.
function parseDict(text) {
  const dic = text.split(/\r\n|\r|\n/);
  if (dic.at(-1) === '') dic[dic.length - 1] = ' ';
  else dic.push(' ');
  return dic;
}

// Class 0 is CTC blank; class i is dict[i - 1]. Out-of-range reads yield ''.
function charAt(dict, i) {
  return dict.at(i - 1) ?? '';
}

// Greedy CTC: per step keep the best two classes (ties go to the later
// class, as upstream), drop blanks and repeats of the previous step's top.
function decode(output, dict) {
  const { data, dims } = output;
  const steps = dims[1];
  const classes = dims[2];
  const chars = [];
  let prevTop = -1;
  for (let s = 0; s < steps; s++) {
    const base = s * classes;
    let best = -1;
    let bestV = 0;
    let second = -1;
    let secondV = 0;
    for (let j = 0; j < classes; j++) {
      const v = data[base + j];
      if (v < PROB_THRESHOLD) continue;
      if (second !== -1 && v <= secondV) continue;
      if (best === -1 || v >= bestV) {
        second = best;
        secondV = bestV;
        best = j;
        bestV = v;
      } else {
        second = j;
        secondV = v;
      }
    }
    if (best === -1) continue;
    const repeat = s > 0 && prevTop === best;
    prevTop = best;
    if (best === 0 || repeat) continue;
    const cands = [{ t: charAt(dict, best), mean: bestV }];
    if (second !== -1) cands.push({ t: charAt(dict, second), mean: secondV });
    chars.push(cands);
  }
  return chars;
}

function createRec({ ort, session, dict, spaceHeuristic = false, imgh = 48 }) {
  const chars = parseDict(dict);

  async function recognizeOne(crop) {
    let img = crop;
    if (img.width < img.height) img = rotateImg(img, -90);
    const w = Math.floor(imgh * (img.width / img.height));
    const resized = resizeImg(img, w, imgh, undefined, false);
    const input = new ort.Tensor('float32', normalizeCHW(resized, REC_MEAN, REC_STD), [1, 3, imgh, w]);
    const out = await session.run({ [session.inputNames[0]]: input });
    return decode(out[session.outputNames[0]], chars);
  }

  async function rec(boxes) {
    const lines = [];
    for (const b of boxes) {
      const cands = await recognizeOne(b.img);
      const picked = cands.map((c) =>
        spaceHeuristic && c[0].t === '' && c[1]?.t === ' ' && c[1].mean > 0.001 ? c[1] : c[0]
      );
      const text = picked
        .map((c) => c.t)
        .join('')
        .trim();
      const mean = picked.reduce((sum, c) => sum + c.mean, 0) / picked.length;
      if (mean < LINE_MIN_MEAN) continue;
      lines.push({ text, mean, box: b.box, style: b.style });
    }
    return lines;
  }

  return { rec };
}

module.exports = { createRec, parseDict, decode };
