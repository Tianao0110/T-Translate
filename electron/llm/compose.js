// Next-word guess for the main window's source box: which part of the typed
// text goes to the built-in model (composeRequest), and which part of the
// model's answer is shown (composeSuffix). The word being typed is finished
// by the Windows predictor (platform/text-prediction.js) instead.
// llm-manager.compose() runs the request; the gate and its numbers are in
// docs/design/renderer.md §1.

const COMPOSE_MIN_PROB = 0.6;
const COMPOSE_MAX_TOKENS = 8;
// Sent text is cut at a sentence start once the box holds more than this,
// so consecutive requests still share the model's cached prefix.
const WINDOW_CHARS = 800;
const PREAMBLE = 'The following is a message written in English.\n\n';

const PLAIN_ASCII = /^[\x20-\x7E\n]*$/;
const WORD_CHAR = /[A-Za-z0-9']/;

// { prompt, fragment } for the model, or null. Only English text that ends
// in one space after a word or punctuation is asked about; the trailing
// space is the fragment the model has to spell itself.
function composeRequest(text) {
  if (typeof text !== 'string' || text.trim().length < 3) return null;
  if (!/\S $/.test(text)) return null;
  const tail = text.slice(-200);
  if (!PLAIN_ASCII.test(tail) || !/[A-Za-z]/.test(tail)) return null;

  let body = text;
  if (text.length > WINDOW_CHARS) {
    const rest = text.slice(text.length - WINDOW_CHARS);
    const m = /[.!?\n]\s+/.exec(rest);
    body = m ? rest.slice(m.index + m[0].length) : rest;
  }
  return { prompt: PREAMBLE + body.slice(0, -1), fragment: ' ' };
}

// The ghost text: the next whole word. A word counts only when what follows
// it shows it ended. '' when there is nothing sure to show.
function composeSuffix(result, fragment) {
  const text = result?.text || '';
  if (!text.startsWith(fragment)) return '';
  const after = text.slice(fragment.length);
  const ended = result.stop === 'eog'
    || (result.stop === 'unsure' && typeof result.stopPiece === 'string' && !WORD_CHAR.test(result.stopPiece[0] || ''));
  const word = /^[A-Za-z0-9']+/.exec(after);
  if (!word) return '';
  const done = word[0].length < after.length ? !WORD_CHAR.test(after[word[0].length]) : ended;
  return done ? word[0] : '';
}

module.exports = { composeRequest, composeSuffix, COMPOSE_MIN_PROB, COMPOSE_MAX_TOKENS };
