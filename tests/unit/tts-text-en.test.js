// English number verbalization in front of the neural TTS: the Chinese rule
// FSTs in the voice packs rewrite any digit into Chinese, so English text must
// reach the engine with its numbers already spelled out.

import { describe, it, expect } from 'vitest';
import { verbalizeEnglishNumbers, hasCjk, integerWords, ordinalWords, yearWords, scaleSpeed } from '../../electron/services/audio-engine/tts-text-en.js';

describe('scaleSpeed', () => {
  it('rebases the slider by the pack scale, per language when given a map', () => {
    expect(scaleSpeed(1, undefined, '你好')).toBe(1);
    expect(scaleSpeed(1, 0.8, '你好')).toBeCloseTo(0.8);
    expect(scaleSpeed(1.5, { zh: 0.8, en: 1 }, '你好')).toBeCloseTo(1.2);
    expect(scaleSpeed(1.5, { zh: 0.8, en: 1 }, 'hello')).toBeCloseTo(1.5);
  });

  it('clamps to the engine range and ignores nonsense', () => {
    expect(scaleSpeed(3, 2, 'x')).toBe(3);
    expect(scaleSpeed(0.1, 1, 'x')).toBe(0.3);
    expect(scaleSpeed(NaN, { zh: 'fast' }, '你好')).toBe(1);
  });
});

describe('integerWords / ordinalWords / yearWords', () => {
  it('spells integers', () => {
    expect(integerWords(0)).toBe('zero');
    expect(integerWords(15)).toBe('fifteen');
    expect(integerWords(42)).toBe('forty-two');
    expect(integerWords(100)).toBe('one hundred');
    expect(integerWords(1234)).toBe('one thousand two hundred thirty-four');
    expect(integerWords(1000000)).toBe('one million');
    expect(integerWords(2500000)).toBe('two million five hundred thousand');
  });

  it('spells ordinals including the irregular ones', () => {
    expect(ordinalWords(1)).toBe('first');
    expect(ordinalWords(2)).toBe('second');
    expect(ordinalWords(3)).toBe('third');
    expect(ordinalWords(12)).toBe('twelfth');
    expect(ordinalWords(15)).toBe('fifteenth');
    expect(ordinalWords(20)).toBe('twentieth');
    expect(ordinalWords(21)).toBe('twenty-first');
    expect(ordinalWords(100)).toBe('one hundredth');
  });

  it('reads years the spoken way', () => {
    expect(yearWords(1999)).toBe('nineteen ninety-nine');
    expect(yearWords(1900)).toBe('nineteen hundred');
    expect(yearWords(1905)).toBe('nineteen oh five');
    expect(yearWords(2000)).toBe('two thousand');
    expect(yearWords(2005)).toBe('two thousand five');
    expect(yearWords(2026)).toBe('twenty twenty-six');
  });
});

describe('verbalizeEnglishNumbers', () => {
  it('leaves text without digits alone', () => {
    expect(verbalizeEnglishNumbers('The quick brown fox.')).toBe('The quick brown fox.');
  });

  it('the spike sentence comes out without a single digit', () => {
    const out = verbalizeEnglishNumbers("On the 15th of September 2026, the price was $3.50, and that didn't seem fair.");
    expect(out).toBe(
      "On the fifteenth of September twenty twenty-six, the price was three dollars and fifty cents, and that didn't seem fair."
    );
    expect(/\d/.test(out)).toBe(false);
  });

  it('currency singular/plural and whole amounts', () => {
    expect(verbalizeEnglishNumbers('$1')).toBe('one dollar');
    expect(verbalizeEnglishNumbers('$20')).toBe('twenty dollars');
    expect(verbalizeEnglishNumbers('$1,000.01')).toBe('one thousand dollars and one cent');
    expect(verbalizeEnglishNumbers('£2.5')).toBe('two pounds and fifty pence');
    expect(verbalizeEnglishNumbers('€3.00')).toBe('three euros');
  });

  it('percent, decimals, times, negatives', () => {
    expect(verbalizeEnglishNumbers('up 15%')).toBe('up fifteen percent');
    expect(verbalizeEnglishNumbers('3.5 %')).toBe('three point five percent');
    expect(verbalizeEnglishNumbers('pi is 3.14')).toBe('pi is three point one four');
    expect(verbalizeEnglishNumbers('at 10:30')).toBe('at ten thirty');
    expect(verbalizeEnglishNumbers('at 9:05')).toBe('at nine oh five');
    expect(verbalizeEnglishNumbers('at 12:00')).toBe("at twelve o'clock");
    expect(verbalizeEnglishNumbers('it was -5 degrees')).toBe('it was minus five degrees');
  });

  it('thousands separators, sentence commas and long digit strings', () => {
    expect(verbalizeEnglishNumbers('1,234 people')).toBe('one thousand two hundred thirty-four people');
    expect(verbalizeEnglishNumbers('I have 3, you have 4.')).toBe('I have three, you have four.');
    expect(verbalizeEnglishNumbers('call 13800138000 now')).toBe('call one three eight zero zero one three eight zero zero zero now');
  });

  it('four-digit numbers in the year range read as years, others as counts', () => {
    expect(verbalizeEnglishNumbers('in 2026')).toBe('in twenty twenty-six');
    expect(verbalizeEnglishNumbers('3000 units')).toBe('three thousand units');
    expect(verbalizeEnglishNumbers('the 15th')).toBe('the fifteenth');
  });
});

describe('hasCjk', () => {
  it('detects Chinese so the worker leaves that text to the FSTs', () => {
    expect(hasCjk('你好 2026')).toBe(true);
    expect(hasCjk('hello 2026')).toBe(false);
  });
});
