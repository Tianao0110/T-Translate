// Main-process language judgment: language-detect.js plus detectors for
// languages that share a script, voted in language-vote.js. ELD and fastText
// load on the first text that needs them; CLD3 and franc only when those two
// leave a text both unplaced and in doubt about the target. All stay for the
// session. Reached through stack:detect-language
// (electron/ipc/translation-stack.js).

import { judgeLanguage, unsure } from './language-detect.js';
import { fromEld, fromFastText, fromCld3, fromFranc, voteFirst, voteFillers } from './language-vote.js';
import createLogger from './logger.js';

const logger = createLogger('LanguageId');

let core = null;
let coreLoading = null;
let fillers = null;
let fillersLoading = null;

async function loadEld() {
  return (await import('eld/extrasmall')).eld;
}

// The model must come off disk: for any other URL the package fetches it
// over the network itself.
async function loadFastText() {
  const { getLIDModel } = await import('fasttext.wasm.js');
  const lid = await getLIDModel();
  if (!String(lid.modelPath).startsWith('file:')) throw new Error(`model path is not a local file: ${lid.modelPath}`);
  return lid.load();
}

async function loadCld3() {
  const { loadModule } = await import('cld3-asm');
  return (await loadModule()).create(0, 1000);
}

async function loadFranc() {
  return (await import('franc')).francAll;
}

async function settle(loaders) {
  const results = await Promise.allSettled(Object.values(loaders).map((load) => load()));
  const loaded = {};
  Object.keys(loaders).forEach((name, i) => {
    const { status, value, reason } = results[i];
    if (status === 'fulfilled') loaded[name] = value;
    else logger.warn(`${name} unavailable:`, reason?.message);
  });
  return Object.keys(loaded).length ? loaded : null;
}

function loadCore() {
  coreLoading ||= settle({ eld: loadEld, fasttext: loadFastText }).then((loaded) => { core = loaded; });
  return coreLoading;
}

function loadFillers() {
  fillersLoading ||= settle({ cld3: loadCld3, franc: loadFranc }).then((loaded) => { fillers = loaded; });
  return fillersLoading;
}

function eldAnswer(text) {
  const result = core.eld.detect(text);
  return { code: fromEld(result.language), reliable: !!result.language && result.isReliable() };
}

// fastText reads one line per prediction.
function fastTextAnswer(text) {
  const vector = core.fasttext.predict(text.replace(/\s+/g, ' '), 1, 0);
  try {
    if (!vector.size()) return null;
    const [score, label] = vector.get(0);
    return { code: fromFastText(label.replace('__label__', ''), text), score };
  } finally {
    vector.delete?.();
  }
}

function cld3Answer(text) {
  const result = fillers.cld3.findLanguage(text);
  return { code: fromCld3(result.language, text), reliable: !!result.is_reliable, score: result.probability };
}

function francAnswer(text) {
  const [top, second] = fillers.franc(text, { minLength: 10 });
  return { code: fromFranc(top[0]), margin: top[1] - (second ? second[1] : 0) };
}

// Set when the first two detectors had no answer and the fillers are not
// loaded yet; detectLanguages loads them and asks again.
let undecided = false;

function identify(text) {
  const fasttext = core.fasttext ? fastTextAnswer(text) : null;
  const first = voteFirst(core.eld ? eldAnswer(text) : null, fasttext);
  if (first || !fillers) {
    if (!first) undecided = true;
    return first;
  }
  return voteFillers(
    fasttext,
    fillers.cld3 ? cld3Answer(text) : null,
    fillers.franc ? francAnswer(text) : null,
  );
}

// One { language, inTarget } per text, in order (judgeLanguage). Texts the
// scripts alone settle never wait for a detector.
export async function detectLanguages(texts, targetLang) {
  const results = [];
  const judge = (indices) => indices.filter((i) => {
    undecided = false;
    results[i] = judgeLanguage(texts[i], targetLang, core ? identify : unsure);
    return results[i].inTarget === null && (!core || undecided);
  });

  let pending = judge(texts.map((_, i) => i));
  if (pending.length && !core) {
    await loadCore();
    if (core) pending = judge(pending);
  }
  if (pending.length && core && !fillers) {
    await loadFillers();
    if (fillers) judge(pending);
  }
  return results;
}
