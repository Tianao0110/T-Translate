// Pinned screenshot: recognize + translate (components/PinWindow/pipeline.js).
// It must never throw, pass the configured OCR engine, honor the
// same-language behavior like the selection window, turn every failure into
// an { error } the pin can show, and translate block by block only when the
// engine gave boxes that fit the image.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ocrRecognize = vi.fn();
const translate = vi.fn();
const detectLanguage = vi.fn();
const detectLanguages = vi.fn();

vi.mock('../../../src/translation/stack-client.js', () => ({
  default: {
    ocr: { recognize: (...args) => ocrRecognize(...args) },
    translate: (...args) => translate(...args),
    detectLanguage: (...args) => detectLanguage(...args),
    detectLanguages: (...args) => detectLanguages(...args),
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
  detectLanguages.mockReset().mockImplementation((texts) => Promise.resolve(texts.map(() => ({ language: 'en', inTarget: false }))));
});

describe('recognizeAndTranslate', () => {
  it('recognizes with the configured engine, then translates the trimmed text', async () => {
    const r = await recognizeAndTranslate('data:image/png;base64,x', init);
    expect(ocrRecognize).toHaveBeenCalledWith('data:image/png;base64,x', { engine: 'rapid-ocr' });
    expect(translate).toHaveBeenCalledWith('Hello world', { sourceLang: 'auto', targetLang: 'zh' });
    expect(r).toEqual({
      mode: 'unified', sourceText: 'Hello world', translatedText: '你好世界',
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

// Two paragraphs with boxes in a 400x200 image (source pixels).
const box = (text, x, y, width, height) => ({ text, bbox: { x, y, width, height } });
const positioned = {
  success: true,
  text: 'Pinned screenshots stay on top.\nClick to switch views.',
  blocks: [box('Pinned screenshots stay on top.', 10, 10, 300, 24), box('Click to switch views.', 10, 120, 220, 24)],
  rawBlocks: [box('Pinned screenshots stay on top.', 10, 10, 300, 24), box('Click to switch views.', 10, 120, 220, 24)],
};
const frame = { width: 400, height: 200 };

describe('recognizeAndTranslate: blocks with boxes', () => {
  it('translates each block on its own and keeps its box', async () => {
    ocrRecognize.mockResolvedValue(positioned);
    translate.mockImplementation((text) => Promise.resolve({ success: true, text: `译:${text.slice(0, 5)}` }));
    const r = await recognizeAndTranslate('img', init, frame);
    expect(r.mode).toBe('blocks');
    expect(translate).toHaveBeenCalledTimes(2);
    expect(r.blocks.map((b) => [b.translatedText, b.bbox.y])).toEqual([['译:Pinne', 10], ['译:Click', 120]]);
    expect(r.lineHeight).toBe(24);
    expect(r.lines.map((l) => l.text)).toEqual(['Pinned screenshots stay on top.', 'Click to switch views.']);
    expect(r.translatedText).toBe('译:Pinne\n译:Click');
    expect(r.passthrough).toBe(false);
  });

  it('keeps going when one block fails, and errors only when all do', async () => {
    ocrRecognize.mockResolvedValue(positioned);
    translate.mockResolvedValueOnce({ success: false, error: 'busy' }).mockResolvedValueOnce({ success: true, text: '点击切换' });
    const partial = await recognizeAndTranslate('img', init, frame);
    expect(partial.mode).toBe('blocks');
    expect(partial.blocks[0]).toMatchObject({ error: 'short:busy' });
    expect(partial.blocks[1].translatedText).toBe('点击切换');

    translate.mockResolvedValue({ success: false, error: 'down' });
    expect(await recognizeAndTranslate('img', init, frame)).toEqual({ error: 'short:down' });
  });

  it('falls back to one translation when the boxes do not fit the image', async () => {
    ocrRecognize.mockResolvedValue(positioned);
    const r = await recognizeAndTranslate('img', init, { width: 100, height: 50 });
    expect(r.mode).toBe('unified');
    expect(translate).toHaveBeenCalledTimes(1);
  });
});
