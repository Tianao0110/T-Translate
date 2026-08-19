// LanguagePicker: the parts a screenshot cannot pin down.
//
// Live verification covered the interactions (letter click jumps, press-drag
// scrubs, three themes, both UI languages). What is locked here is the
// contract those interactions rest on: which language lands in which group,
// what a chip is labelled, and that a remembered letter is discarded when the
// UI language changes it out from under itself.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import LanguagePicker from '../../src/components/shared/LanguagePicker.jsx';
import { LANGUAGES } from '../../src/config/languages.js';

let uiLanguage = 'en';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key, fallback) => fallback,
    i18n: { get language() { return uiLanguage; } },
  }),
}));

const byCode = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));
const pick = (...codes) => codes.map((c) => byCode[c]);

function open(props = {}) {
  const onChange = vi.fn();
  const utils = render(
    <LanguagePicker
      value="zh"
      onChange={onChange}
      options={pick('auto', 'zh', 'nl', 'de', 'ja', 'am')}
      {...props}
    />
  );
  fireEvent.click(utils.container.querySelector('.lp-trigger'));
  return { ...utils, onChange };
}

beforeEach(() => { uiLanguage = 'en'; });

describe('chip labels follow the UI language', () => {
  it('shows the English name in an English UI', () => {
    const { container } = open();
    const names = [...container.querySelectorAll('.lp-chip-name')].map((n) => n.textContent);
    expect(names).toContain('Amharic');
    expect(names).not.toContain('阿姆哈拉语');
  });

  it('shows the Chinese name in a Chinese UI — the endonym is unreadable here', () => {
    uiLanguage = 'zh';
    const { container } = open();
    const names = [...container.querySelectorAll('.lp-chip-name')].map((n) => n.textContent);
    expect(names).toContain('阿姆哈拉语');
    expect(names).not.toContain('አማርኛ');
  });

  it('keeps the endonym in the tooltip', () => {
    const { container } = open();
    const chip = [...container.querySelectorAll('.lp-chip')]
      .find((c) => c.textContent.includes('Amharic'));
    expect(chip.getAttribute('title')).toBe('አማርኛ');
  });

  it('carries the code as the small label', () => {
    const { container } = open();
    const codes = [...container.querySelectorAll('.lp-chip-code')].map((n) => n.textContent);
    expect(codes).toContain('AM');
    expect(codes).toContain('ZH');
  });
});

describe('letter groups follow the UI language', () => {
  it('files Dutch under D in English and 荷兰语 under H in Chinese', () => {
    const { container, unmount } = open();
    let letters = [...container.querySelectorAll('.lp-index-letter')].map((e) => e.textContent);
    expect(letters).toContain('D');   // Dutch, German
    expect(letters).not.toContain('H');
    unmount();

    uiLanguage = 'zh';
    const second = open();
    letters = [...second.container.querySelectorAll('.lp-index-letter')].map((e) => e.textContent);
    expect(letters).toContain('H');   // 荷兰语
    expect(letters).toContain('D');   // 德语
  });

  it('pins auto-detect outside the letter groups', () => {
    const { container } = open();
    const autoSection = container.querySelector('.lp-section-auto');
    expect(within(autoSection).getByText('Auto Detect')).toBeTruthy();
    // It must not ALSO appear inside a letter group (A already exists here —
    // Amharic lives there — so the check is on the chips, not the letters).
    const inGroups = [...container.querySelectorAll('.lp-list .lp-section')]
      .filter((s) => !s.classList.contains('lp-section-auto'))
      .flatMap((s) => [...s.querySelectorAll('.lp-chip-name')].map((n) => n.textContent));
    expect(inGroups).not.toContain('Auto Detect');
  });
});

describe('recent section', () => {
  it('pins recently used languages above the alphabet', () => {
    const { container } = open({ recent: ['ja', 'de'] });
    const sections = [...container.querySelectorAll('.lp-section')];
    const recentSection = sections.find((s) => s.textContent.includes('最近使用'));
    const names = [...recentSection.querySelectorAll('.lp-chip-name')].map((n) => n.textContent);
    expect(names).toEqual(['Japanese', 'German']);
  });

  it('ignores codes that are not in this picker', () => {
    const { container } = open({ recent: ['ja', 'xx-not-real'] });
    const recentSection = [...container.querySelectorAll('.lp-section')]
      .find((s) => s.textContent.includes('最近使用'));
    expect(recentSection.querySelectorAll('.lp-chip')).toHaveLength(1);
  });
});

describe('selection and memory', () => {
  it('reports the picked code and closes', () => {
    const { container, onChange } = open();
    const chip = [...container.querySelectorAll('.lp-chip')]
      .find((c) => c.textContent.includes('German'));
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith('de');
    expect(container.querySelector('.lp-panel')).toBeNull();
  });

  it('records the browsed letter together with the language it means', () => {
    const onBrowse = vi.fn();
    const { container } = open({ onBrowse });
    const letterD = [...container.querySelectorAll('.lp-index-letter')]
      .find((e) => e.textContent === 'D');
    fireEvent.click(letterD);
    // The letter alone is ambiguous: D is German in English, 德语 in Chinese.
    expect(onBrowse).toHaveBeenCalledWith('D', 'en');
  });

  it('marks user-added languages so they are identifiable at a glance', () => {
    const { container } = open({ customCodes: ['am'] });
    const chip = [...container.querySelectorAll('.lp-chip')]
      .find((c) => c.textContent.includes('Amharic'));
    expect(chip.className).toContain('custom');
  });
});
