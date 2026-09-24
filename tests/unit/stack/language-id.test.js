// The main-process judgment: ELD settles languages that share the target's
// script, and only when it is confident.

import { describe, it, expect } from 'vitest';
import { detectLanguages } from '../../../src/stack/language-id.js';

describe('detectLanguages (ELD)', () => {
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
});
