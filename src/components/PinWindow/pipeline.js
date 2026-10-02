// Pinned screenshot: recognize the image, then translate the text through the
// main-process stack (translation/stack-client.js). Local OCR reads first; the
// engine chosen in settings only gets images it cannot read. With box coordinates each
// block is translated on its own and goes back over its spot (granularity from
// floating/display-mode.js); without them the whole text is translated as one.
// Same language handling as the selection window's screenshot path.

import translationService from '../../translation/stack-client.js';
import { resolveSameLanguageTarget, shouldTranslateText, cleanTranslationOutput } from '../../core/text.js';
import { getShortErrorMessage, detectErrorType, ERROR_TYPES } from '../../core/error-handler.js';
import { resolveDisplayMode } from '../../floating/display-mode.js';
import { isUsableResult } from '../../stack/ocr/result-quality.js';
import i18n from '../../i18n.js';

const CONCURRENCY = 2;

// A known kind of failure gets its friendly wording; anything else keeps the
// stack's own message, which already says what to do.
function describeError(error, options) {
  const raw = typeof error === 'string' ? error : error?.message || String(error);
  return detectErrorType(raw) === ERROR_TYPES.UNKNOWN ? raw : getShortErrorMessage(raw, options);
}

const median = (nums) => {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Resolves to one of, never throws:
//   { mode: 'blocks', blocks: [{ text, bbox, translatedText?, passthrough?, error? }], lines: [{ text, bbox }], lineHeight, partialError, ...summary }
//   { mode: 'unified', ...summary }
//   { error }
// summary = { sourceText, translatedText, sourceLanguage, targetLanguage, passthrough }.
// `frame` is the image's natural size, the OCR boxes' pixel space.
export async function recognizeAndTranslate(image, { ocrEngine, targetLanguage = 'zh', sameLanguageBehavior = 'original' } = {}, frame = null) {
  try {
    const ocr = await recognizeLocalFirst(image, ocrEngine);
    if (!ocr?.success) {
      return { error: describeError(ocr?.error || i18n.t('svc.ocrFailed'), { context: 'ocr' }) };
    }

    const sourceText = ocr.text?.trim();
    if (!sourceText) return { error: i18n.t('svc.noTextRecognized') };

    const rawBlocks = ocr.rawBlocks || ocr.blocks || [];
    const { useScattered, blocks } = resolveDisplayMode('scattered', rawBlocks, ocr.blocks || [], frame);
    const settings = { targetLanguage, sameLanguageBehavior };
    if (useScattered) return await translateBlocks(blocks, rawBlocks, settings);
    return await translateWhole(sourceText, settings);
  } catch (e) {
    return { error: describeError(e) };
  }
}

const LOCAL_ENGINE = 'rapid-ocr';

async function recognizeLocalFirst(image, ocrEngine) {
  const local = await translationService.ocr.recognize(image, { engine: LOCAL_ENGINE });
  if (isUsableResult(local, LOCAL_ENGINE) || !ocrEngine || ocrEngine === LOCAL_ENGINE) return local;
  return translationService.ocr.recognize(image, { engine: ocrEngine });
}

async function translateWhole(sourceText, { targetLanguage, sameLanguageBehavior }) {
  if (!shouldTranslateText(sourceText)) {
    return { mode: 'unified', sourceText, translatedText: sourceText, targetLanguage, passthrough: true };
  }

  const detected = await translationService.detectLanguage(sourceText, targetLanguage);
  const resolved = resolveSameLanguageTarget(detected?.inTarget, targetLanguage, sameLanguageBehavior, 'auto');
  const sourceLanguage = detected?.language || 'auto';
  if (resolved.passthrough) {
    return { mode: 'unified', sourceText, translatedText: sourceText, sourceLanguage, targetLanguage, passthrough: true };
  }

  const result = await translationService.translate(sourceText, {
    sourceLang: 'auto',
    targetLang: resolved.targetLang,
  });
  if (!result?.success) {
    return { error: describeError(result?.detail || result?.error || i18n.t('selection.translateFailed'), { provider: result?.provider }) };
  }
  if (!result.text) return { error: i18n.t('selection.emptyResult') };

  return {
    mode: 'unified',
    sourceText,
    translatedText: result.text,
    sourceLanguage,
    targetLanguage: resolved.targetLang,
    passthrough: false,
  };
}

async function translateBlocks(picked, rawBlocks, { targetLanguage, sameLanguageBehavior }) {
  const blocks = picked
    .filter((b) => b.text?.trim() && b.bbox?.width > 0 && b.bbox?.height > 0)
    .map((b) => ({ text: b.text.trim(), bbox: { ...b.bbox } }));
  const texts = blocks.map((b) => b.text);
  const detected = await translationService.detectLanguages(texts, targetLanguage);

  let translatedAny = false;
  let usedTarget = targetLanguage;
  const translateOne = async (block, i) => {
    if (!shouldTranslateText(block.text)) {
      block.translatedText = block.text;
      block.passthrough = true;
      return;
    }
    const resolved = resolveSameLanguageTarget(detected[i]?.inTarget, targetLanguage, sameLanguageBehavior, 'auto');
    if (resolved.passthrough) {
      block.translatedText = block.text;
      block.passthrough = true;
      return;
    }
    try {
      const result = await translationService.translate(block.text, { sourceLang: 'auto', targetLang: resolved.targetLang });
      if (result?.success && result.text) {
        block.translatedText = cleanTranslationOutput(result.text, block.text) || result.text;
        translatedAny = true;
        usedTarget = resolved.targetLang;
      } else {
        block.error = describeError(result?.detail || result?.error || i18n.t('selection.translateFailed'), { provider: result?.provider });
      }
    } catch (e) {
      block.error = describeError(e);
    }
  };

  for (let i = 0; i < blocks.length; i += CONCURRENCY) {
    await Promise.all(blocks.slice(i, i + CONCURRENCY).map((b, j) => translateOne(b, i + j)));
  }

  // Judged on the blocks that needed translating.
  const failed = blocks.filter((b) => b.error);
  const needed = blocks.filter((b) => !b.passthrough);
  if (needed.length && failed.length === needed.length) return { error: failed[0].error };
  const done = blocks.filter((b) => b.translatedText);

  const lines = rawBlocks
    .filter((b) => b.text?.trim() && b.bbox?.width > 0 && b.bbox?.height > 0)
    .map((b) => ({ text: b.text.trim(), bbox: { ...b.bbox } }));
  return {
    mode: 'blocks',
    blocks,
    lines,
    lineHeight: lines.length ? median(lines.map((l) => l.bbox.height)) : null,
    sourceText: texts.join('\n'),
    translatedText: done.map((b) => b.translatedText).join('\n'),
    sourceLanguage: detected.find((d) => d?.language)?.language || 'auto',
    targetLanguage: usedTarget,
    passthrough: !translatedAny,
    partialError: failed[0]?.error || null,
  };
}
