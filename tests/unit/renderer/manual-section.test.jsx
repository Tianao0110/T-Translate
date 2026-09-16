// The user guide section: the shipped Markdown renders with a chapter list,
// follows the UI language, and sends external links to the system browser.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

let language = 'zh';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { get language() { return language; } },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('../../../docs/MANUAL.zh.md?raw', () => ({
  default: '# 标题\n\n## 0. 开始使用\n\n### 0.1 安装\n\n看 [官网](https://example.com/) 和 [下一章](#1-主窗口)。\n\n## 1. 主窗口\n\n正文。\n',
}));
vi.mock('../../../docs/MANUAL.en.md?raw', () => ({
  default: '# Title\n\n## 0. Getting started\n\nEnglish body.\n',
}));

const ManualSection = (await import('../../../src/components/SettingsPanel/sections/ManualSection.jsx')).default;

afterEach(() => {
  cleanup();
  language = 'zh';
  delete window.electron;
});

describe('ManualSection', () => {
  it('renders the chapter list and the body from the Chinese guide', () => {
    const { container, getByText } = render(<ManualSection />);
    const toc = container.querySelectorAll('.manual-toc-link');
    expect([...toc].map((b) => b.textContent)).toEqual(['0. 开始使用', '0.1 安装', '1. 主窗口']);
    expect(getByText('正文。')).toBeInTheDocument();
    expect(document.getElementById('1-主窗口')?.tagName).toBe('H2');
  });

  it('switches to the English guide with the UI language', () => {
    language = 'en';
    const { getByText, queryByText } = render(<ManualSection />);
    expect(getByText('English body.')).toBeInTheDocument();
    expect(queryByText('正文。')).toBeNull();
  });

  it('opens http links through the shell bridge instead of navigating', () => {
    const openExternal = vi.fn();
    window.electron = { shell: { openExternal } };
    const { getByText } = render(<ManualSection />);
    const link = getByText('官网');
    const event = fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/');
    expect(event).toBe(false);
  });

  it('scrolls to an in-page anchor without leaving the page', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { getByText } = render(<ManualSection />);
    fireEvent.click(getByText('下一章'));
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
