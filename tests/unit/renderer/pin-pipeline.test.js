// Pinned screenshot: recognize + translate (components/PinWindow/pipeline.js).
// It must never throw, pass the configured OCR engine, honor the
// same-language behavior like the selection window, and turn every failure
// into an { error } the pin can show.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ocrRecognize = vi.fn();
const translate = vi.fn();
const detectLanguage = vi.fn();

vi.mock('../../../src/translation/stack-client.js', () => ({
  default: {
    ocr: { recognize: (...args) => ocrRecognize(...args) },
    translate: (...args) => translate(...args),
    detectLanguage: (...args) => detectLanguage(...args),
  },
}));

vi.mock('../../../src/core/error-handler.js', () => ({
  getShortErrorMessage: (err) => `short:${err?.message || err}`,
}));

const { recognizeAndTranslate } = await import('../../../src/components/PinWindow/pipeline.js');

const init = { ocrEngine: 'rapid-ocr', targetLanguage: 'zh', sameLanguageBehavior: 'original' };

beforeEach(() => {
  ocrRecognize.mockReset().mockResolvedValue({ success: true, text: ' Hello world ' });
  detectLanguage.mockReset().mockResolvedValue({ language: 'en', inTarget: false });
  translate.mockReset().mockResolvedValue({ success: true, text: '你好世界' });
});

describe('recognizeAndTranslate', () => {
  it('recognizes with the configured engine, then translates the trimmed text', async () => {
    const r = await recognizeAndTranslate('data:image/png;base64,x', init);
    expect(ocrRecognize).toHaveBeenCalledWith('data:image/png;base64,x', { engine: 'rapid-ocr' });
    expect(translate).toHaveBeenCalledWith('Hello world', { sourceLang: 'auto', targetLang: 'zh' });
    expect(r).toEqual({
      sourceText: 'Hello world', translatedText: '你好世界',
      sourceLanguage: 'en', targetLanguage: 'zh', passthrough: false,
    });
  });

  it('passes text already in the target language through untranslated', async () => {
    ocrRecognize.mockResolvedValue({ success: true, text: '已经是中文的一句话' });
    detectLanguage.mockResolvedValue({ language: 'zh', inTarget: true });
    const r = await recognizeAndTranslate('img', init);
    expect(translate).not.toHaveBeenCalled();
    expect(r).toMatchObject({ translatedText: '已经是中文的一句话', passthrough: true });
  });

  it('swaps the target when the behavior says so', async () => {
    ocrRecognize.mockResolvedValue({ success: true, text: '已经是中文的一句话' });
    detectLanguage.mockResolvedValue({ language: 'zh', inTarget: true });
    translate.mockResolvedValue({ success: true, text: 'Already Chinese' });
    const r = await recognizeAndTranslate('img', { ...init, sameLanguageBehavior: 'swap' });
    expect(translate).toHaveBeenCalledWith('已经是中文的一句话', { sourceLang: 'auto', targetLang: 'en' });
    expect(r).toMatchObject({ translatedText: 'Already Chinese', targetLanguage: 'en', passthrough: false });
  });

  it('turns OCR failure, empty text, translate failure and empty output into errors', async () => {
    ocrRecognize.mockResolvedValueOnce({ success: false, error: 'engine down' });
    expect(await recognizeAndTranslate('img', init)).toEqual({ error: 'short:engine down' });

    ocrRecognize.mockResolvedValueOnce({ success: true, text: '   ' });
    expect((await recognizeAndTranslate('img', init)).error).toBeTruthy();

    translate.mockResolvedValueOnce({ success: false, error: 'provider down' });
    expect(await recognizeAndTranslate('img', init)).toEqual({ error: 'short:provider down' });

    translate.mockResolvedValueOnce({ success: true, text: '' });
    expect((await recognizeAndTranslate('img', init)).error).toBeTruthy();
  });

  it('never throws', async () => {
    ocrRecognize.mockRejectedValueOnce(new Error('ipc gone'));
    expect(await recognizeAndTranslate('img', init)).toEqual({ error: 'short:ipc gone' });
  });

  it('skips translation for text with nothing to translate', async () => {
    ocrRecognize.mockResolvedValue({ success: true, text: '12:30 — 45%' });
    const r = await recognizeAndTranslate('img', init);
    expect(translate).not.toHaveBeenCalled();
    expect(r).toMatchObject({ translatedText: '12:30 — 45%', passthrough: true });
  });
});
