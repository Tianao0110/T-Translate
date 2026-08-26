// Regression: the password-modal description used dangerouslySetInnerHTML with
// the raw filename, and the filename is attacker-controlled now that Explorer
// right-click can open any file (name and all). A name like
// `<img src=x onerror=…>.pdf` executed script in the renderer. The fix renders
// the filename as a React child; this test proves a payload name lands as inert
// text, not as a DOM element.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, fallbackOrOpts) => (typeof fallbackOrOpts === 'string' ? fallbackOrOpts : key),
    i18n: { language: 'zh' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('../../src/services/stack-client.js', () => ({
  default: { onChanged: () => () => {}, translate: vi.fn(), ocr: { recognize: vi.fn() } },
}));

vi.mock('../../src/services/ai-action-runner.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runAiAction: vi.fn(),
  getActionCapabilities: async () => ({ text: false, vision: false }),
}));

// Force the password-required branch so the modal renders with our filename.
vi.mock('../../src/utils/document-parser.js', async (importOriginal) => ({
  ...(await importOriginal()),
  parseDocument: vi.fn(async () => ({ needPassword: true })),
}));

const DocumentTranslator = (await import('../../src/components/DocumentTranslator/index.jsx')).default;

beforeEach(() => {
  window.electron = undefined;
});

const PAYLOAD = '<img src=x onerror="window.__xss_fired=true">.pdf';

describe('password modal filename is not an HTML sink', () => {
  it('renders a malicious filename as inert text, injecting no <img>', async () => {
    window.__xss_fired = undefined;

    const file = new File(['%PDF-1.4 encrypted'], PAYLOAD, { type: 'application/pdf' });
    const { container } = render(
      <DocumentTranslator notify={() => {}} externalFile={file} onExternalFileConsumed={() => {}} />
    );

    // Password modal appears once parseDocument resolves needPassword.
    await waitFor(() => {
      expect(container.querySelector('.password-modal')).toBeTruthy();
    });

    // The payload must NOT have become a real element…
    expect(container.querySelector('img')).toBeNull();
    // …and the onerror handler must never have run.
    expect(window.__xss_fired).toBeUndefined();

    // The filename should still be visible to the user, as text.
    expect(container.querySelector('.password-modal-desc')?.textContent).toContain(PAYLOAD);
  });
});
