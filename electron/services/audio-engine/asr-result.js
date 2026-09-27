// Lenient parse of sherpa's hand-written result JSON: control characters
// become spaces (they are unescaped inside the text field).
function parseAsrResultJson(raw) {
  let out = '';
  for (const ch of String(raw)) out += ch < ' ' ? ' ' : ch;
  return JSON.parse(out);
}

module.exports = { parseAsrResultJson };
