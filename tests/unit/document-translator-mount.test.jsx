// A mount smoke test, and it exists because two crashes shipped past a green
// suite and a green build:
//
//   - an icon imported from lucide-react that the installed version does not
//     export (eslint and vite both resolve the named import happily; React
//     throws when it renders)
//   - a useCallback dependency array naming a const declared further down, so
//     the whole panel died at render on the temporal dead zone
//
// Neither is reachable by testing pure functions. Rendering the component once
// is what catches them, so this asks for nothing more than "it mounts".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, fallbackOrOpts) =>
      (typeof fallbackOrOpts === 'string' ? fallbackOrOpts : key),
    i18n: { language: 'zh' },
  }),
  // src/i18n.js calls .use(initReactI18next) at import time.
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('../../src/services/stack-client.js', () => ({
  default: {
    onChanged: () => () => {},
    translate: vi.fn(),
    ocr: { recognize: vi.fn() },
  },
}));

vi.mock('../../src/services/ai-action-runner.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runAiAction: vi.fn(),
  getActionCapabilities: async () => ({ text: false, vision: false }),
}));

const DocumentTranslator = (await import('../../src/components/DocumentTranslator/index.jsx')).default;

beforeEach(() => {
  window.electron = undefined;
});

describe('DocumentTranslator mounts', () => {
  it('renders the empty state without throwing', () => {
    const { container } = render(<DocumentTranslator notify={() => {}} />);
    expect(container.querySelector('.document-translator')).toBeTruthy();
  });

  it('renders with the languages it was handed', () => {
    const { container } = render(
      <DocumentTranslator notify={() => {}} sourceLang="en" targetLang="ja" />
    );
    expect(container.querySelector('.document-translator')).toBeTruthy();
  });

  it('offers the file input, which is the only way in', () => {
    const { container } = render(<DocumentTranslator notify={() => {}} />);
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
  });

  it('consumes an externally handed file (context-menu open) exactly once', async () => {
    const consumed = vi.fn();
    const file = new File(['hello external world'], 'open-with.txt', { type: 'text/plain' });

    const { rerender } = render(
      <DocumentTranslator notify={() => {}} externalFile={file} onExternalFileConsumed={consumed} />
    );

    await waitFor(() => expect(consumed).toHaveBeenCalledTimes(1));

    // Parent clears the slot; a re-render with the same object must not re-load.
    rerender(
      <DocumentTranslator notify={() => {}} externalFile={file} onExternalFileConsumed={consumed} />
    );
    expect(consumed).toHaveBeenCalledTimes(1);
  });
});
