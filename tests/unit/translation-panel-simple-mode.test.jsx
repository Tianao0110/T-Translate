// S-2 progressive disclosure on the main panel: simple mode hides the heavy
// controls (tone templates, style rewrite, image import) and full mode keeps
// today's everything. Also the first mount smoke test TranslationPanel gets.

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

describe('TranslationPanel progressive disclosure', () => {
  it('full mode (stored) shows templates, style rewrite, and image import', () => {
    localStorage.setItem('main-simple-mode', 'false');
    const { container } = renderPanel();
    expect(container.querySelector('.template-btn')).toBeTruthy();
    expect(container.querySelector('.style-btn')).toBeTruthy();
    expect(container.querySelectorAll('.box-actions .action-btn').length).toBeGreaterThan(0);
    expect(container.querySelector('.mode-text-link')).toBeTruthy();
  });

  it('simple mode (stored) hides them but keeps translate/copy/favorite and the toggle', () => {
    localStorage.setItem('main-simple-mode', 'true');
    const { container } = renderPanel();
    expect(container.querySelector('.template-btn')).toBeNull();
    expect(container.querySelector('.style-btn')).toBeNull();
    // the toggle back to full stays reachable
    expect(container.querySelector('.mode-text-link')).toBeTruthy();
    // core surfaces stay
    expect(container.querySelector('.translation-textarea')).toBeTruthy();
  });

  it('the MT badge is gone in both modes (mechanism still runs main-process side)', () => {
    localStorage.setItem('main-simple-mode', 'false');
    const { container } = renderPanel();
    expect(container.querySelector('.mt-mode-badge')).toBeNull();
  });
});
