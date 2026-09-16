// Lenient parse of sherpa's hand-written result JSON: control characters
// become spaces (they are unescaped inside the text field).
function parseAsrResultJson(raw) {
  let out = '';
  for (const ch of String(raw)) out += ch < ' ' ? ' ' : ch;
  return JSON.parse(out);
}

// Keeps what follows Qwen3-ASR's <asr_text> marker; sherpa strips the frame
// only when it opens the reply.
const ASR_TEXT_MARK = '<asr_text>';

function stripAsrFrame(text) {
  const s = String(text || '');
  const at = s.lastIndexOf(ASR_TEXT_MARK);
  return at === -1 ? s : s.slice(at + ASR_TEXT_MARK.length);
}

module.exports = { parseAsrResultJson, stripAsrFrame };
