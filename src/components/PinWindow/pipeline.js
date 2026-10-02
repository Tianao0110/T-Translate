// Pinned screenshot: recognize the image, then translate the text through the
// main-process stack (translation/stack-client.js). Same language handling as
// the selection window's screenshot path.

import translationService from '../../translation/stack-client.js';
import { resolveSameLanguageTarget, shouldTranslateText } from '../../core/text.js';
import { getShortErrorMessage } from '../../core/error-handler.js';
import i18n from '../../i18n.js';

// Resolves to { sourceText, translatedText, sourceLanguage, targetLanguage, passthrough }
// or { error }; never throws.
export async function recognizeAndTranslate(image, { ocrEngine, targetLanguage = 'zh', sameLanguageBehavior = 'original' } = {}) {
  try {
    const ocr = await translationService.ocr.recognize(image, ocrEngine ? { engine: ocrEngine } : {});
    if (!ocr?.success) {
      return { error: getShortErrorMessage(ocr?.error || i18n.t('svc.ocrFailed'), { context: 'ocr' }) };
    }

    const sourceText = ocr.text?.trim();
    if (!sourceText) return { error: i18n.t('svc.noTextRecognized') };

    if (!shouldTranslateText(sourceText)) {
      return { sourceText, translatedText: sourceText, targetLanguage, passthrough: true };
    }

    const detected = await translationService.detectLanguage(sourceText, targetLanguage);
    const resolved = resolveSameLanguageTarget(detected?.inTarget, targetLanguage, sameLanguageBehavior, 'auto');
    const sourceLanguage = detected?.language || 'auto';
    if (resolved.passthrough) {
      return { sourceText, translatedText: sourceText, sourceLanguage, targetLanguage, passthrough: true };
    }

    const result = await translationService.translate(sourceText, {
      sourceLang: 'auto',
      targetLang: resolved.targetLang,
    });
    if (!result?.success) {
      return { error: getShortErrorMessage(result?.error || i18n.t('selection.translateFailed'), { provider: result?.provider }) };
    }
    if (!result.text) return { error: i18n.t('selection.emptyResult') };

    return {
      sourceText,
      translatedText: result.text,
      sourceLanguage,
      targetLanguage: resolved.targetLang,
      passthrough: false,
    };
  } catch (e) {
    return { error: getShortErrorMessage(e) };
  }
}
