// Neural voice selection: which installed pack/speaker reads a given text.

import { describe, it, expect } from 'vitest';
import { pickVoice, isMixedText, detectTextLang, normalizeLang } from '../../src/utils/tts-voice-pick.js';

const kokoro = (sid, lang, gender, featured) => ({
  id: `tts-kokoro-zh-en:${sid}`,
  packId: 'tts-kokoro-zh-en',
  sid,
  lang,
  gender,
  featured,
  preferMixed: false,
  languages: ['zh', 'en'],
});
const melo = {
  id: 'tts-melo-zh-en:0',
  packId: 'tts-melo-zh-en',
  sid: 0,
  lang: 'zh',
  gender: 'f',
  featured: true,
  preferMixed: true,
  languages: ['zh', 'en'],
};
const kokoroOnly = [kokoro(0, 'en', 'f', true), kokoro(1, 'en', 'f', true), kokoro(3, 'zh', 'f', true), kokoro(4, 'zh', 'f', false), kokoro(58, 'zh', 'm', true)];
const both = [...kokoroOnly, melo];

describe('normalizeLang / detectTextLang / isMixedText', () => {
  it('maps region variants and Cantonese to the pack language', () => {
    expect(normalizeLang('zh-CN')).toBe('zh');
    expect(normalizeLang('en_US')).toBe('en');
    expect(normalizeLang('yue')).toBe('zh');
    expect(normalizeLang('auto')).toBe('');
  });

  it('guesses from script when no language is given', () => {
    expect(detectTextLang('你好')).toBe('zh');
    expect(detectTextLang('hello there')).toBe('en');
    expect(detectTextLang('123')).toBe('');
  });

  it('mixed = CJK plus at least one Latin word', () => {
    expect(isMixedText('我们用 Kokoro 做 TTS')).toBe(true);
    expect(isMixedText('我们做语音')).toBe(false);
    expect(isMixedText('plain english')).toBe(false);
    expect(isMixedText('第3句')).toBe(false); // digits are not a word
  });
});

describe('pickVoice', () => {
  it('auto mode picks a featured voice of the target language', () => {
    expect(pickVoice(kokoroOnly, { lang: 'zh', text: '你好' }).id).toBe('tts-kokoro-zh-en:3');
    expect(pickVoice(kokoroOnly, { lang: 'en-US', text: 'hi' }).id).toBe('tts-kokoro-zh-en:0');
  });

  it('falls back to text script when the language is auto', () => {
    expect(pickVoice(kokoroOnly, { lang: 'auto', text: 'The fox' }).lang).toBe('en');
    expect(pickVoice(kokoroOnly, { text: '狐狸' }).lang).toBe('zh');
  });

  it('honors an explicit voice that can read the language', () => {
    expect(pickVoice(kokoroOnly, { voiceId: 'tts-kokoro-zh-en:58', lang: 'zh', text: '你好' }).sid).toBe(58);
    // a Chinese speaker can read English (accented) — the user's pick stands
    expect(pickVoice(kokoroOnly, { voiceId: 'tts-kokoro-zh-en:58', lang: 'en', text: 'hello' }).sid).toBe(58);
  });

  it('drops an explicit voice whose pack cannot read the language at all', () => {
    expect(pickVoice(kokoroOnly, { voiceId: 'tts-kokoro-zh-en:58', lang: 'ja', text: 'こんにちは' })).toBeNull();
  });

  it('routes mixed zh/en text to the preferMixed pack when installed', () => {
    expect(pickVoice(both, { lang: 'zh', text: '我们用 Kokoro 做 TTS' }).packId).toBe('tts-melo-zh-en');
    // without MeloTTS, kokoro reads it anyway
    expect(pickVoice(kokoroOnly, { lang: 'zh', text: '我们用 Kokoro 做 TTS' }).packId).toBe('tts-kokoro-zh-en');
  });

  it('an explicit voice still wins over the mixed-text preference', () => {
    expect(pickVoice(both, { voiceId: 'tts-kokoro-zh-en:3', lang: 'zh', text: '我们用 Kokoro 做 TTS' }).sid).toBe(3);
  });

  it('per-language choices apply to their own language only', () => {
    const byLang = { zh: 'tts-kokoro-zh-en:58', en: 'tts-kokoro-zh-en:1' };
    expect(pickVoice(kokoroOnly, { voiceByLang: byLang, lang: 'zh', text: '你好' }).sid).toBe(58);
    expect(pickVoice(kokoroOnly, { voiceByLang: byLang, lang: 'en', text: 'hello' }).sid).toBe(1);
    // auto language still resolves from the text
    expect(pickVoice(kokoroOnly, { voiceByLang: byLang, text: 'hello there' }).sid).toBe(1);
  });

  it('a per-language choice whose voice is gone falls back to the featured voice', () => {
    expect(pickVoice(kokoroOnly, { voiceByLang: { en: 'tts-kokoro-zh-en:99' }, lang: 'en', text: 'hi' }).sid).toBe(0);
  });

  it('a per-language choice is final: mixed text does not get rerouted to the mixed pack', () => {
    const byLang = { zh: 'tts-kokoro-zh-en:58' };
    expect(pickVoice(both, { voiceByLang: byLang, lang: 'zh', text: '我们用 Kokoro 做 TTS' }).sid).toBe(58);
    // nothing chosen for the language: auto mode still prefers the mixed pack
    expect(pickVoice(both, { voiceByLang: { en: 'tts-kokoro-zh-en:0' }, lang: 'zh', text: '我们用 Kokoro 做 TTS' }).packId).toBe('tts-melo-zh-en');
  });

  it('a single-speaker pack that covers the language is used when no native voice exists', () => {
    expect(pickVoice([melo], { lang: 'en', text: 'hello' }).packId).toBe('tts-melo-zh-en');
  });

  it('returns null when no pack covers the language (caller falls back to system voices)', () => {
    expect(pickVoice(both, { lang: 'ja', text: 'こんにちは' })).toBeNull();
    expect(pickVoice([], { lang: 'zh', text: '你好' })).toBeNull();
  });
});
