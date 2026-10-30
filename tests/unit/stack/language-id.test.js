// @vitest-environment node
// The main-process judgment with the real detectors (Node, as in the main
// process): languages that share the target's script are settled only when
// the vote is confident.

import { describe, it, expect } from 'vitest';
import { detectLanguages } from '../../../src/stack/language-id.js';

describe('detectLanguages', () => {
  it('settles other scripts without ELD', async () => {
    const [zh, mixed] = await detectLanguages([
      '在 Kubernetes 集群中部署 Docker 容器时，需要配置 Service 和 Ingress。',
      'In Chinese philosophy, yin and yang (阴阳) describes complementary forces.',
    ], 'zh');
    expect(zh.inTarget).toBe(true);
    expect(mixed.inTarget).toBe(false);
  });

  it('tells French from English', async () => {
    const [fr, en, ru] = await detectLanguages([
      'Je ne sais pas ce que tu veux dire.',
      'The best way to predict the future is to invent it.',
      'Я не знаю, что ты имеешь в виду.',
    ], 'en');
    expect(fr).toEqual({ language: 'fr', inTarget: false });
    expect(en).toEqual({ language: 'en', inTarget: true });
    expect(ru.inTarget).toBe(false);
  });

  it('tells Ukrainian from Russian', async () => {
    const [uk] = await detectLanguages(['Я не знаю, що ти маєш на увазі.'], 'ru');
    expect(uk).toEqual({ language: 'uk', inTarget: false });
  });

  it('stays unsure about a word it cannot place', async () => {
    const [word] = await detectLanguages(['Bonjour'], 'en');
    expect(word.inTarget).toBeNull();
  });

  it('does not take a language ELD lacks for its nearest relative', async () => {
    const [af] = await detectLanguages(['Ek is baie lief vir my familie en ons woon in Kaapstad naby die see.'], 'nl');
    const [ne] = await detectLanguages(['नेपाल एक सुन्दर देश हो। यहाँ धेरै हिमालहरू छन् र मानिसहरू मिलनसार छन्।'], 'hi');
    expect(af).toEqual({ language: 'af', inTarget: false });
    expect(ne).toEqual({ language: 'ne', inTarget: false });
  });

  it('places languages only CLD3 and franc know', async () => {
    const [zu, sw] = await detectLanguages([
      'Sawubona, unjani namhlanje? Ngiyabonga kakhulu ngosizo lwakho izolo.',
      'Ninapenda kusoma vitabu na kunywa chai asubuhi kabla ya kwenda kazini.',
    ], 'en');
    expect(zu).toEqual({ language: 'zu', inTarget: false });
    expect(sw).toEqual({ language: 'sw', inTarget: false });
  });
});
