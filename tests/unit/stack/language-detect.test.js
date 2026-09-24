// The judgment behind the same-language setting (selection, floating
// window) and the document "skip paragraphs already in target language"
// filter: mixed text reads as the target language only when the target holds
// most of it and everything else is name- or term-sized.

import { describe, it, expect } from 'vitest';
import { judgeLanguage, mainLanguage, unsure } from '../../../src/stack/language-detect.js';
import { LANGUAGES } from '../../../src/config/languages.js';

describe('mainLanguage', () => {
  it('names the language of single-script text', () => {
    expect(mainLanguage('Hello world')).toBe('en');
    expect(mainLanguage('你好世界')).toBe('zh');
    expect(mainLanguage('これはペンです')).toBe('ja');
    expect(mainLanguage('안녕하세요')).toBe('ko');
    expect(mainLanguage('Привет, как дела?')).toBe('ru');
    expect(mainLanguage('مرحبا بالعالم')).toBe('ar');
    expect(mainLanguage('नमस्ते दुनिया')).toBe('hi');
    expect(mainLanguage('สวัสดีครับ')).toBe('th');
    expect(mainLanguage('Γειά σου Κόσμε')).toBe('el');
  });

  it('goes by the larger share, one CJK character against one word', () => {
    expect(mainLanguage('In Chinese philosophy, yin and yang (阴阳) describes complementary forces.')).toBe('en');
    expect(mainLanguage('在 Kubernetes 集群中部署 Docker 容器时，需要配置 Service 和 Ingress。')).toBe('zh');
  });

  it('reads kanji with kana as Japanese, but not Chinese with a kaomoji', () => {
    expect(mainLanguage('首相、辞任を表明')).toBe('ja');
    expect(mainLanguage('ラーメン')).toBe('ja');
    expect(mainLanguage('好吧，我也不知道该怎么办了 ¯\\_(ツ)_/¯')).toBe('zh');
  });

  it('is null without letters of a known script', () => {
    expect(mainLanguage('')).toBeNull();
    expect(mainLanguage('12345 --- !!')).toBeNull();
    expect(mainLanguage('ཀུན་མཁྱེན')).toBeNull();
  });

  it('knows the script of every catalogue language', () => {
    for (const { code, nativeName } of LANGUAGES) {
      if (code === 'auto') continue;
      expect(mainLanguage(nativeName), code).not.toBeNull();
    }
  });
});

describe('judgeLanguage: already in the target language?', () => {
  it('translates English with a few Chinese characters into Chinese', () => {
    expect(judgeLanguage('In Chinese philosophy, yin and yang (阴阳) describes how opposite forces may be complementary.', 'zh'))
      .toEqual({ language: 'en', inTarget: false });
    expect(judgeLanguage('The sign read 禁止吸烟, which means no smoking.', 'zh').inTarget).toBe(false);
  });

  it('leaves Chinese with English terms as Chinese', () => {
    expect(judgeLanguage('在 Kubernetes 集群中部署 Docker 容器时，需要配置 Service 和 Ingress。', 'zh').inTarget).toBe(true);
    expect(judgeLanguage('使用 React Server Components 和 Next.js App Router 可以提升首屏加载性能。', 'zh').inTarget).toBe(true);
    expect(judgeLanguage('According to 王小明, the project led by 李华 will be finished next year.', 'en').inTarget).toBe(true);
  });

  it('translates a whole foreign sentence inside target-language text', () => {
    expect(judgeLanguage('他说：Stay hungry, stay foolish. 这句话很有名。', 'zh').inTarget).toBe(false);
    expect(judgeLanguage('He said 我今天不想去上班 and walked away.', 'en').inTarget).toBe(false);
  });

  it('draws the term line at 3 words and 4 characters', () => {
    const zh = '这是一段很长的中文说明文字，用来测试术语长度';
    expect(judgeLanguage(`${zh} one two three`, 'zh').inTarget).toBe(true);
    expect(judgeLanguage(`${zh} one two three four`, 'zh').inTarget).toBe(false);
    const en = 'This is a fairly long English sentence written to hold the larger share of the text';
    expect(judgeLanguage(`${en} 王小明说`, 'en').inTarget).toBe(true);
    expect(judgeLanguage(`${en} 王小明说过`, 'en').inTarget).toBe(false);
  });

  it('needs the target to hold more than half', () => {
    expect(judgeLanguage('I love 北京', 'zh').inTarget).toBe(false);
  });

  it('translates mixed text into a third language', () => {
    expect(judgeLanguage('这个项目使用了 React and TypeScript to build the frontend，效果很好。', 'ko').inTarget).toBe(false);
  });

  it('does not take other scripts for English', () => {
    expect(judgeLanguage('Я не знаю, что ты имеешь в виду.', 'en')).toEqual({ language: 'ru', inTarget: false });
    expect(judgeLanguage('Я не знаю, что ты имеешь в виду.', 'ru').inTarget).toBe(true);
    expect(judgeLanguage('لا أعرف ماذا تقصد.', 'en').inTarget).toBe(false);
  });

  it('has nothing to translate without letters, and never matches an empty target', () => {
    expect(judgeLanguage('12345', 'zh')).toEqual({ language: 'auto', inTarget: true });
    expect(judgeLanguage('Hello world', '').inTarget).toBe(false);
  });
});

describe('judgeLanguage with identify (languages sharing a script)', () => {
  const french = 'Je ne sais pas ce que tu veux dire.';

  it('takes the identified language', () => {
    expect(judgeLanguage(french, 'en', () => 'fr')).toEqual({ language: 'fr', inTarget: false });
    expect(judgeLanguage(french, 'fr', () => 'fr').inTarget).toBe(true);
  });

  it('is unsure only when unsettled text decides the answer', () => {
    expect(judgeLanguage(french, 'en', unsure)).toEqual({ language: 'en', inTarget: null });
    expect(judgeLanguage(french, 'zh', unsure).inTarget).toBe(false);
    expect(judgeLanguage(`${french} 这是一段很长的中文句子`, 'en', unsure).inTarget).toBe(false);
    expect(judgeLanguage('这是一段很长的中文句子 Paris', 'zh', unsure).inTarget).toBe(true);
  });

  it('ignores an answer from another script', () => {
    expect(judgeLanguage('Hello world, how are you?', 'en', () => 'ru').inTarget).toBeNull();
  });
});
