// sherpa-onnx writes its result JSON by hand and never escapes control
// characters, so a recognizer that emits a newline inside the text (Qwen3-ASR
// does on hallucinated fragments) produces a document JSON.parse rejects.
// Replacing every control character with a space is valid both inside string
// literals and between tokens, and the space disappears in the caller's trim().
function parseAsrResultJson(raw) {
  let out = '';
  for (const ch of String(raw)) out += ch < ' ' ? ' ' : ch;
  return JSON.parse(out);
}

// Qwen3-ASR answers as "language X<asr_text>words"; sherpa-onnx strips that
// frame only when it opens the reply, so a hallucinated lead-in ("提纲\n")
// leaks the whole frame into the subtitle. Keep what follows the marker.
const ASR_TEXT_MARK = '<asr_text>';

function stripAsrFrame(text) {
  const s = String(text || '');
  const at = s.lastIndexOf(ASR_TEXT_MARK);
  return at === -1 ? s : s.slice(at + ASR_TEXT_MARK.length);
}

module.exports = { parseAsrResultJson, stripAsrFrame };
