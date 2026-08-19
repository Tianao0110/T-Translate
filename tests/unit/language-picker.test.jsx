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

describe('adding a custom language', () => {
  const openWithAdd = (props = {}) => {
    const onAddCustom = vi.fn();
    const utils = open({ onAddCustom, ...props });
    fireEvent.click(utils.container.querySelector('.lp-add-entry'));
    return { ...utils, onAddCustom };
  };

  it('states the risk before the fields, not after', () => {
    const { container } = openWithAdd();
    const warn = container.querySelector('.lp-add-warn');
    expect(warn.textContent).toContain('取决于');
    // The warning must precede the inputs — an acknowledgement shown after the
    // work is done is not an acknowledgement.
    const form = container.querySelector('.lp-add');
    expect([...form.children].indexOf(warn)).toBe(0);
  });

  it('sends the typed name to the model when no override is given', () => {
    const { container, onAddCustom } = openWithAdd();
    fireEvent.change(container.querySelectorAll('.lp-add-field input')[0], {
      target: { value: '藏语' },
    });
    fireEvent.click(container.querySelector('.lp-add-confirm'));

    expect(onAddCustom).toHaveBeenCalledWith(expect.objectContaining({
      name: '藏语',
      promptName: '藏语',
      code: '藏语',   // the code IS what the prompt says
      custom: true,
    }));
  });

  it('lets the model be told something other than what the picker shows', () => {
    // A local model may know Tibetan and not 藏语, or the reverse — only the
    // person who loaded it knows which.
    const { container, onAddCustom } = openWithAdd();
    const [nameInput, promptInput] = container.querySelectorAll('.lp-add-field input');
    fireEvent.change(nameInput, { target: { value: '藏语' } });
    fireEvent.change(promptInput, { target: { value: 'Tibetan' } });
    fireEvent.click(container.querySelector('.lp-add-confirm'));

    expect(onAddCustom).toHaveBeenCalledWith(expect.objectContaining({
      name: '藏语',
      promptName: 'Tibetan',
      code: 'Tibetan',
    }));
  });

  it('selects the language it just added — that is why the user was here', () => {
    const { container, onChange } = openWithAdd();
    fireEvent.change(container.querySelectorAll('.lp-add-field input')[0], {
      target: { value: '藏语' },
    });
    fireEvent.click(container.querySelector('.lp-add-confirm'));
    expect(onChange).toHaveBeenCalledWith('藏语');
  });

  it('refuses an empty name and a duplicate, without calling back', () => {
    const { container, onAddCustom } = openWithAdd({
      existingCustom: [{ code: '藏语', name: '藏语' }],
    });
    fireEvent.click(container.querySelector('.lp-add-confirm'));
    expect(container.querySelector('.lp-add-error')).toBeTruthy();

    fireEvent.change(container.querySelectorAll('.lp-add-field input')[0], {
      target: { value: '藏语' },
    });
    fireEvent.click(container.querySelector('.lp-add-confirm'));
    expect(container.querySelector('.lp-add-error')).toBeTruthy();
    expect(onAddCustom).not.toHaveBeenCalled();
  });

  it('offers no entry point when the caller cannot accept one', () => {
    const { container } = open();
    expect(container.querySelector('.lp-add-entry')).toBeNull();
  });
});

describe('custom languages stay out of the alphabet', () => {
  // Their "letter" is the first character of a name the user typed, which put
  // a stray 藏 on the end of an otherwise A-Z strip.
  const withCustom = () => open({
    onAddCustom: vi.fn(),
    options: [...pick('auto', 'zh', 'de'), { code: 'Tibetan', name: '藏语', en: '藏语', custom: true }],
    customCodes: ['Tibetan'],
  });

  it('keeps the index strip free of user-typed characters', () => {
    const { container } = withCustom();
    const letters = [...container.querySelectorAll('.lp-index-letter')].map((e) => e.textContent);
    expect(letters.every((l) => /^[A-Z]$/.test(l))).toBe(true);
    expect(letters).not.toContain('藏');
  });

  it('gives them their own pinned section', () => {
    const { container } = withCustom();
    const titles = [...container.querySelectorAll('.lp-list > .lp-section')]
      .map((s) => s.querySelector('.lp-section-title')?.textContent.trim());
    expect(titles).toContain('自定义');

    const customSection = [...container.querySelectorAll('.lp-list > .lp-section')]
      .find((s) => s.querySelector('.lp-section-title')?.textContent.trim() === '自定义');
    expect(customSection.querySelector('.lp-chip-name').textContent).toBe('藏语');
  });

  it('drops the code tag — a custom code is a whole prompt name', () => {
    const { container } = withCustom();
    const chip = [...container.querySelectorAll('.lp-chip.custom')][0];
    expect(chip.querySelector('.lp-chip-code')).toBeNull();
    expect(chip.textContent.trim()).toBe('藏语');
  });
});
