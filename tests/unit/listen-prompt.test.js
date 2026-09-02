import { describe, it, expect } from 'vitest';
import { buildListenSystemPrompt } from '../../src/utils/listen-prompt.js';

describe('buildListenSystemPrompt', () => {
  it('names the target language in the UI language and keeps the context out of the user turn', () => {
    const p = buildListenSystemPrompt({ targetLang: 'zh', context: ['first line', 'second line'], uiLang: 'en' });
    expect(p.mode).toBe('system');
    expect(p.content).toContain('into Chinese');
    expect(p.content).toContain('- first line');
    expect(p.content).toContain('- second line');
    expect(p.content).toContain('do not translate them');
  });

  it('switches wording with the UI language', () => {
    const p = buildListenSystemPrompt({ targetLang: 'en', context: ['前一句'], uiLang: 'zh-CN' });
    expect(p.content).toContain('翻译成英文');
    expect(p.content).toContain('不要翻译它们');
    expect(p.content).toContain('- 前一句');
  });

  it('omits the context block when there is nothing before', () => {
    const p = buildListenSystemPrompt({ targetLang: 'ja', context: [], uiLang: 'en' });
    expect(p.content).not.toContain('Preceding lines');
    expect(p.content).toContain('Japanese');
  });

  it('keeps only the last two lines and bounds their length', () => {
    const long = 'x'.repeat(400);
    const p = buildListenSystemPrompt({ targetLang: 'en', context: ['a', 'b', long, 'd'], uiLang: 'en' });
    expect(p.content).toContain('- d');
    expect(p.content).not.toContain('- a');
    expect(p.content).not.toContain(long); // over the budget once 'd' is in
  });
});
