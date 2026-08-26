// Latin-script language detection for voice picking. Before this, every
// Latin-alphabet text fell through to 'en' and got read by an English voice.
// Tier 1 = exclusive marks, tier 2 = shared-accent best guess; these tests pin
// the intended winners, not the documented trade-off misses.

import { describe, it, expect } from 'vitest';
import { WebSpeechEngine } from '../../src/services/tts/web-speech.js';

const engine = new WebSpeechEngine(); // jsdom has no speechSynthesis — fine, _detectLanguage is pure
const detect = (text) => engine._detectLanguage(text);

describe('non-Latin scripts (unchanged)', () => {
  it.each([
    ['你好世界', 'zh'],
    ['こんにちは', 'ja'],
    ['안녕하세요', 'ko'],
    ['Привет, мир', 'ru'],
    ['مرحبا بالعالم', 'ar'],
  ])('%s -> %s', (text, lang) => {
    expect(detect(text)).toBe(lang);
  });
});

describe('tier 1 — exclusive marks', () => {
  it.each([
    ['Die Straße ist lang', 'de'],
    ['¿Dónde está el baño?', 'es'],
    ['mañana por la mañana', 'es'],
    ['não faz mal, coração', 'pt'],
    ['un cœur fidèle', 'fr'],
    ['được rồi, cảm ơn bạn', 'vi'],
    ['dziękuję, do zobaczenia część', 'pl'],
    ['dobrý den, příteli', 'cs'],
    ['teşekkür ederim', 'tr'],
    ['jövő héten találkozunk', 'hu'],
    ['tak, det er færdigt', 'da'],
    ['Hej då, välkommen åter', 'sv'],
    ['på norsk, takk', 'no'],
  ])('%s -> %s', (text, lang) => {
    expect(detect(text)).toBe(lang);
  });

  it('dotless ı must not case-fold onto plain English I', () => {
    expect(detect('I AM SHOUTING IN ENGLISH')).toBe('en');
  });
});

describe('tier 2 — shared accents, best guess', () => {
  it.each([
    ['Ça va très bien', 'fr'],       // ç
    ['être ou ne pas être', 'fr'],   // ê
    ['La città è bella', 'it'],      // grave-only tail
    ['così va il mondo', 'it'],      // ì
    ['está aquí, gracias', 'es'],    // acute vowels
    ['schön für dich', 'de'],        // ä/ö/ü without ß
  ])('%s -> %s', (text, lang) => {
    expect(detect(text)).toBe(lang);
  });
});

describe('fallback', () => {
  it('plain Latin text still lands on en', () => {
    expect(detect('plain english text with no accents')).toBe('en');
  });
  it('empty input returns null', () => {
    expect(detect('')).toBe(null);
  });
});

describe('voice picking for refined languages', () => {
  it('Norwegian maps onto an nb-NO voice (prefix match alone cannot find it)', () => {
    const e = new WebSpeechEngine();
    e._voices = [
      { name: 'English', lang: 'en-US', voiceURI: 'en1' },
      { name: 'Norsk', lang: 'nb-NO', voiceURI: 'nb1' },
    ];
    const { voice } = e._findVoice('no', null, '');
    expect(voice?.voiceURI).toBe('nb1');
  });

  it('detected Polish picks the pl-PL voice over English', () => {
    const e = new WebSpeechEngine();
    e._voices = [
      { name: 'English', lang: 'en-US', voiceURI: 'en1' },
      { name: 'Polski', lang: 'pl-PL', voiceURI: 'pl1' },
    ];
    const { voice, lang } = e._findVoice('auto', null, 'dziękuję bardzo, część');
    expect(lang).toBe('pl');
    expect(voice?.voiceURI).toBe('pl1');
  });

  it('detected Spanish with no Spanish voice reports NO_VOICE_FOR_LANG-ready null', () => {
    const e = new WebSpeechEngine();
    e._voices = [{ name: 'English', lang: 'en-US', voiceURI: 'en1' }];
    const { voice, lang } = e._findVoice('auto', null, '¿Cómo estás?');
    expect(lang).toBe('es');
    expect(voice).toBe(null);
  });
});
