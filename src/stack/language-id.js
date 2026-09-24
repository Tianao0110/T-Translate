// Main-process language judgment: language-detect.js plus ELD (Efficient
// Language Detector, eld/extrasmall) for languages that share a script. ELD
// loads on the first text that needs it and stays for the session. Reached
// through stack:detect-language (electron/ipc/translation-stack.js).

import { judgeLanguage, unsure } from './language-detect.js';
import createLogger from './logger.js';

const logger = createLogger('LanguageId');

// ELD codes that name a different catalogue entry.
const ELD_CODES = { ku: 'ckb' };

let eld = null;
let loading = null;

function loadEld() {
  loading ||= import('eld/extrasmall')
    .then((mod) => {
      eld = mod.eld;
    })
    .catch((e) => {
      logger.warn('ELD unavailable, shared-script text stays undecided:', e.message);
    });
  return loading;
}

function identify(text) {
  const result = eld.detect(text);
  if (!result.language || !result.isReliable()) return null;
  return ELD_CODES[result.language] || result.language;
}

// One { language, inTarget } per text, in order (judgeLanguage). Texts the
// scripts alone settle never wait for ELD.
export async function detectLanguages(texts, targetLang) {
  if (eld) return texts.map((text) => judgeLanguage(text, targetLang, identify));
  const quick = texts.map((text) => judgeLanguage(text, targetLang, unsure));
  if (!quick.some((result) => result.inTarget === null)) return quick;
  await loadEld();
  if (!eld) return quick;
  return texts.map((text, i) => (quick[i].inTarget === null ? judgeLanguage(text, targetLang, identify) : quick[i]));
}
