// PP-OCR pipeline (detection + recognition + reading-order layout) on
// onnxruntime-node, derived from esearch-ocr 8.5.0 (Apache-2.0, (c)
// xushengfeng, https://github.com/xushengfeng/eSearch-OCR). Changes from
// upstream: pre/post-processing rewritten on flat typed arrays, boxes come
// from connected components instead of contour tracing, and the browser,
// debug, document-direction and layout-model code is gone. Only what the
// OCR host calls is kept, with the same result shape.
const image = require('./image');
const { createDet } = require('./det');
const { createRec } = require('./rec');
const { afAfRec } = require('./layout');

// det/rec: onnx paths; dict: contents of the rec dictionary; ortOption is
// applied to both sessions. spaceHeuristic is for v3/v4 rec models only.
async function createOcr({ ort, ortOption, canvasKit, det, rec, dict, spaceHeuristic = false, imgh = 48 }) {
  image.setCanvasKit(canvasKit);
  const detSession = await ort.InferenceSession.create(det, ortOption);
  const recSession = await ort.InferenceSession.create(rec, ortOption);
  const detector = createDet({ ort, session: detSession });
  const recognizer = createRec({ ort, session: recSession, dict, spaceHeuristic, imgh });

  return {
    async ocr(imageData) {
      const boxes = await detector.det(imageData);
      const lines = await recognizer.rec(boxes);
      return { src: lines, ...afAfRec(lines) };
    },
    det: detector.det,
    rec: recognizer.rec,
  };
}

module.exports = { createOcr };
