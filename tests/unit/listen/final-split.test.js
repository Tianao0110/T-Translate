// Companion finals cut into caption pieces: sentence ends, then clause marks
// and pauses near the middle, narrow leftovers merged, token-start times or
// width-shared times, and finals that stay whole coming back untouched.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { splitFinal, MAX_WIDTH } = require('../../../electron/listen/final-split.js');

const WORD = '\u{2581}';

// 'So@0.06 the@0.30 ~,@2.46': a token per item, '~' glues it to the one before.
function marksOf(spec) {
  const tokens = [];
  const timestamps = [];
  for (const item of spec.trim().split(/\s+/)) {
    const [tok, t] = item.split('@');
    tokens.push(tok.startsWith('~') ? tok.slice(1) : WORD + tok);
    timestamps.push(Number(t));
  }
  return { tokens, timestamps };
}
const textOf = (marks) => marks.tokens.join('').replace(/\u{2581}/gu, ' ').trim();
const recOf = (text, segDurS) => ({ id: 7, segStartS: 100, segDurS, text, textLen: text.length, lang: '<|en|>' });
const brief = (pieces) => pieces.map((p) => [p.segStartS, p.segDurS, p.text]);

// Real SenseVoice output for 10.7 s of fast synthesized speech; it dropped
// the full stop after 'off', so the pause there is the only sentence clue.
const EN = marksOf(`So@0.06 the@0.30 first@0.42 thing@0.66 you@0.84 want@0.96 to@1.08 do@1.20 is@1.32 open@1.50 the@1.74
  settings@1.86 page@2.22 ~,@2.46 then@3.06 you@3.30 scroll@3.48 down@3.78 ~,@3.96 find@4.32 the@4.56 network@4.74 tab@5.10
  ~,@5.34 and@5.52 turn@5.70 the@5.94 pro@6.12 ~x@6.24 ~y@6.36 off@6.48 If@7.32 that@7.50 does@7.62 not@7.86 work@8.04 ~,@8.28
  restart@8.58 the@9.00 computer@9.12 and@9.42 try@9.60 again@9.84 ~.@10.56`);

describe('splitFinal', () => {
  it('cuts a long English final at clauses and pauses, timed by token starts', () => {
    expect(brief(splitFinal(recOf(textOf(EN), 10.69), EN))).toEqual([
      [100, 2.96, 'So the first thing you want to do is open the settings page,'],
      [102.96, 1.26, 'then you scroll down,'],
      [104.22, 3, 'find the network tab, and turn the proxy off'],
      [107.22, 3.47, 'If that does not work, restart the computer and try again.'],
    ]);
  });

  it('cuts Chinese at sentence ends first, then at the comma nearest the middle', () => {
    const text = '今天我们来聊一聊浏览器插件的字幕显示。首先，字号要能调，其次，长句要切开，最后语速快的时候旧字幕不能马上消失。';
    const pieces = splitFinal(recOf(text, 11), null);
    expect(pieces.map((p) => p.text)).toEqual(['今天我们来聊一聊浏览器插件的字幕显示。', '首先，字号要能调，其次，长句要切开，', '最后语速快的时候旧字幕不能马上消失。']);
    expect(pieces[0].segStartS).toBe(100);
    const last = pieces[pieces.length - 1];
    expect(last.segStartS + last.segDurS).toBeCloseTo(111, 5);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].segStartS).toBeCloseTo(pieces[i - 1].segStartS + pieces[i - 1].segDurS, 5);
  });

  it('keeps the rest of the record and a final that fits comes back as it was', () => {
    const short = recOf('Hello there, how are you doing today?', 2);
    expect(splitFinal(short, null)[0]).toBe(short);
    const [first] = splitFinal(recOf(textOf(EN), 10.69), EN);
    expect(first).toMatchObject({ id: 7, lang: '<|en|>', textLen: first.text.length });
  });

  it('joins a narrow sentence to its neighbour', () => {
    const text = 'Okay. So that is the plan for today, and we will start with the very first part of it.';
    expect(splitFinal(recOf(text, 6), null).map((p) => p.text)).toEqual(['Okay. So that is the plan for today,', 'and we will start with the very first part of it.']);
  });

  it('never cuts inside a word or before punctuation, and every piece fits', () => {
    const text = 'we keep talking without any punctuation at all because the recognizer sometimes forgets it entirely and then the line just runs on and on';
    const pieces = splitFinal(recOf(text, 9), null);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((p) => p.text).join(' ')).toBe(text);
    for (const p of pieces) expect(p.text.length).toBeLessThanOrEqual(MAX_WIDTH);
    for (const p of splitFinal(recOf(textOf(EN), 10.69), EN)) expect(p.text).not.toMatch(/^[\p{P}]/u);
  });

  it('cuts Korean only between words', () => {
    const text = '오늘은 브라우저 확장 프로그램의 자막 표시에 대해 이야기해 보겠습니다 먼저 글자 크기를 조절할 수 있어야 하고 긴 문장은 나누어야 합니다';
    const pieces = splitFinal(recOf(text, 9), null);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((p) => p.text).join(' ')).toBe(text);
  });

  it('falls back to width-shared times when the marks do not spell the text', () => {
    const wrong = { ...EN, tokens: EN.tokens.slice(1) };
    const pieces = splitFinal(recOf(textOf(EN), 10.69), { tokens: wrong.tokens, timestamps: EN.timestamps.slice(1) });
    expect(pieces[0].segStartS).toBe(100);
    expect(pieces.every((p) => p.segDurS > 0)).toBe(true);
    const last = pieces[pieces.length - 1];
    expect(last.segStartS + last.segDurS).toBeCloseTo(110.69, 5);
  });
});
