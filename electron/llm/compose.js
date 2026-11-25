// Ghost-text compose for the main window's source box: which part of the
// typed text goes to the built-in model (composeRequest), and which part of
// the model's answer is shown (composeSuffix). llm-manager.compose() runs
// the request; the gate and its numbers are in docs/design/renderer.md.

const COMPOSE_MIN_PROB = 0.6;
const COMPOSE_MAX_TOKENS = 8;
// Sent text is cut at a sentence start once the box holds more than this,
// so consecutive requests still share the model's cached prefix.
const WINDOW_CHARS = 800;
const PREAMBLE = 'The following is a message written in English.\n\n';

const PLAIN_ASCII = /^[\x20-\x7E\n]*$/;
const WORD_CHAR = /[A-Za-z0-9']/;

// { prompt, fragment } for the model, or null when the text is not English
// typing that can be continued. `fragment` is the end of the text the model
// must spell itself: the word being typed (with its leading space), a single
// trailing space, or nothing after punctuation.
function composeRequest(text) {
  if (typeof text !== 'string' || text.trim().length < 3) return null;
  if (/\n$/.test(text) || /\s\s$/.test(text)) return null;
  const tail = text.slice(-200);
  if (!PLAIN_ASCII.test(tail) || !/[A-Za-z]/.test(tail)) return null;

  let body = text;
  if (text.length > WINDOW_CHARS) {
    const rest = text.slice(text.length - WINDOW_CHARS);
    const m = /[.!?\n]\s+/.exec(rest);
    body = m ? rest.slice(m.index + m[0].length) : rest;
  }
  const m = / ?[A-Za-z']+$|[ ]$/.exec(body);
  const fragment = m ? m[0] : '';
  return { prompt: PREAMBLE + body.slice(0, body.length - fragment.length), fragment };
}

// The ghost text: the rest of the word being typed, then one more whole
// word. A word counts only when what follows it shows it ended, so nothing
// half a word long is ever offered. '' when there is nothing sure to show.
function composeSuffix(result, fragment) {
  const text = result?.text || '';
  if (!text.startsWith(fragment)) return '';
  const after = text.slice(fragment.length);
  const ended = result.stop === 'eog'
    || (result.stop === 'unsure' && typeof result.stopPiece === 'string' && !WORD_CHAR.test(result.stopPiece[0] || ''));
  const boundaryAt = (i) => (i < after.length ? !WORD_CHAR.test(after[i]) : ended);

  let out = '';
  if (/[A-Za-z']$/.test(fragment)) {
    out = /^[A-Za-z0-9']*/.exec(after)[0];
    if (!boundaryAt(out.length)) return '';
  }
  const next = /^\s*[A-Za-z0-9']+/.exec(after.slice(out.length));
  if (next && boundaryAt(out.length + next[0].length)) out += next[0];
  if (!/^[\x20-\x7E]*$/.test(out) || !/[A-Za-z0-9]/.test(out)) return '';
  return out;
}

module.exports = { composeRequest, composeSuffix, COMPOSE_MIN_PROB, COMPOSE_MAX_TOKENS };
