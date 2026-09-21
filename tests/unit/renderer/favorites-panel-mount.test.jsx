// FavoritesPanel mount smoke (its first), plus the tag browser: the sidebar
// keeps one row of tags and an expand button; all tags open over the whole
// sidebar, and the cards on the right filter as one is picked.
//
// Regression this replaces: the tag list had no height limit, so a few dozen
// tags squeezed the folder list down to two or three rows.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('../../../src/core/logger.js', () => ({
  default: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'zh' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('../../../src/translation/stack-client.js', () => ({
  default: { onChanged: () => () => {}, translate: vi.fn(), chatCompletion: vi.fn() },
}));

const useTranslationStore = (await import('../../../src/stores/translation-store.js')).default;
const FavoritesPanel = (await import('../../../src/components/FavoritesPanel/index.jsx')).default;

const fav = (id, tags) => ({
  id, sourceText: `source ${id}`, translatedText: `译文 ${id}`, sourceLanguage: 'en', targetLanguage: 'zh',
  tags, folderId: 'work', timestamp: Date.now(),
});

beforeEach(() => {
  global.window.electron = undefined;
  localStorage.clear();
  useTranslationStore.setState({
    favorites: [fav('a', ['古风', '典雅']), fav('b', ['武侠', '江湖']), fav('c', ['武侠', '对决'])],
  });
});

afterEach(() => {
  cleanup();
});

const tagNames = (root) => [...root.querySelectorAll('.tag-item')].map((el) => el.textContent.trim());

describe('FavoritesPanel', () => {
  it('mounts with folders, cards and a closed tag browser', () => {
    const { container } = render(<FavoritesPanel showNotification={() => {}} />);
    expect(container.querySelector('.folder-list')).toBeTruthy();
    expect(container.querySelectorAll('.favorite-card').length).toBe(3);
    expect(container.querySelector('.tag-expand-btn')).toBeTruthy();
    expect(container.querySelector('.tag-overlay')).toBeNull();
    expect(container.querySelector('.sidebar-section-title .tag-count').textContent).toBe('5');
  });

  it('the expand button opens every tag over the sidebar, and closes it again', () => {
    const { container } = render(<FavoritesPanel showNotification={() => {}} />);
    fireEvent.click(container.querySelector('.tag-expand-btn'));

    const overlay = container.querySelector('.favorites-sidebar .tag-overlay');
    expect(overlay).toBeTruthy();
    expect(container.querySelector('.favorites-main .tag-overlay')).toBeNull();
    expect(tagNames(overlay).sort()).toEqual(['典雅', '古风', '对决', '武侠', '江湖'].sort());
    expect(container.querySelector('.tag-expand-btn').getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(container.querySelector('.tag-overlay-close'));
    expect(container.querySelector('.tag-overlay')).toBeNull();
  });

  it('picking a tag filters the cards while the browser stays open, and leads the one-row list', () => {
    const { container } = render(<FavoritesPanel showNotification={() => {}} />);
    fireEvent.click(container.querySelector('.tag-expand-btn'));
    const pick = [...container.querySelectorAll('.tag-overlay-body .tag-item')].find((el) => el.textContent.trim() === '武侠');
    fireEvent.click(pick);

    expect(container.querySelector('.tag-overlay')).toBeTruthy();
    expect(pick.classList.contains('active')).toBe(true);
    expect(container.querySelectorAll('.favorite-card').length).toBe(2);

    fireEvent.click(container.querySelector('.tag-overlay-close'));
    expect(container.querySelector('.tag-overlay')).toBeNull();
    const first = container.querySelector('.tag-list .tag-item');
    expect(first.textContent.trim()).toBe('武侠');
    expect(first.classList.contains('active')).toBe(true);
  });

  it('shows no tag section when nothing is tagged', () => {
    useTranslationStore.setState({ favorites: [fav('a', [])] });
    const { container } = render(<FavoritesPanel showNotification={() => {}} />);
    expect(container.querySelector('.tag-expand-btn')).toBeNull();
    expect(container.querySelector('.tag-list')).toBeNull();
  });
});
