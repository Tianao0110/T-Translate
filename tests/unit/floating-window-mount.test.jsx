// Mount smoke test for FloatingWindow — the floating-overlay window component.
// Catches render-time-only crashes (missing lucide exports, temporal dead
// zones in the hook block) that a green build walks straight past.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('../../src/services/pipeline.js', () => ({
  default: {
    capture: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(),
    retranslate: vi.fn(() => Promise.resolve()),
    getLastCaptureImage: vi.fn(() => null),
  },
}));

vi.mock('../../src/services/ai-action-runner.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runAiAction: vi.fn(),
  getActionCapabilities: async () => ({ text: false, vision: false }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key, fallback) => (typeof fallback === 'string' ? fallback : _key), i18n: { language: 'zh' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const FloatingWindow = (await import('../../src/components/FloatingWindow/index.jsx')).default;

beforeEach(() => {
  // The real window always has the preload bridge; every access is optional-
  // chained, so mounting without it exercises the graceful path.
  global.window.electron = undefined;
});

afterEach(() => {
  cleanup();
});

describe('FloatingWindow mounts', () => {
  it('renders the overlay shell without throwing', () => {
    const { container } = render(<FloatingWindow />);
    expect(container.querySelector('.floating-window')).toBeTruthy();
  });

  it('renders the top drag area (capture entry point)', () => {
    const { container } = render(<FloatingWindow />);
    expect(container.querySelector('.floating-top-area')).toBeTruthy();
  });
});
