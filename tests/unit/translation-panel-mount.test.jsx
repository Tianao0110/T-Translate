// TranslationPanel mount smoke (its first): render-time crashes, plus two
// S-2 outcomes pinned — the MT badge is gone for good, and the tone templates
// stay always-visible (a simple/full split was tried and reverted the same
// day; this stops it from silently coming back half-wired).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('../../src/utils/logger.js', () => ({
  default: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key, fallback) => (typeof fallback === 'string' ? fallback : _key), i18n: { language: 'zh' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('../../src/services/ai-action-runner.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runAiAction: vi.fn(),
  getActionCapabilities: async () => ({ text: false, vision: false }),
}));

vi.mock('../../src/services/ocr.js', () => ({
  recognizeImage: vi.fn(() => Promise.resolve({ success: false })),
  getOcrStatus: vi.fn(() => Promise.resolve(null)),
}));

const TranslationPanel = (await import('../../src/components/TranslationPanel/index.jsx')).default;

beforeEach(() => {
  global.window.electron = undefined;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

function renderPanel() {
  return render(<TranslationPanel screenshotData={null} onScreenshotProcessed={() => {}} />);
}

describe('TranslationPanel', () => {
  it('mounts with the full toolbar: templates, style rewrite, textareas', () => {
    const { container } = renderPanel();
    expect(container.querySelectorAll('.template-btn').length).toBe(3);
    expect(container.querySelector('.style-btn')).toBeTruthy();
    expect(container.querySelector('.translation-textarea')).toBeTruthy();
  });

  it('the MT badge stays removed (mechanism lives main-process side)', () => {
    const { container } = renderPanel();
    expect(container.querySelector('.mt-mode-badge')).toBeNull();
  });

  it('no simple/full toggle exists on the main panel (reverted by user verdict)', () => {
    const { container } = renderPanel();
    expect(container.querySelector('.mode-text-link')).toBeNull();
  });
});
