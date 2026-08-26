// Mount smoke test for SettingsPanel — the heaviest component in the app: its
// import graph pulls in all eleven section files, so a single bad lucide
// import or temporal dead zone anywhere in them kills the whole panel at
// render while tests and build stay green. Mounting once covers the lot.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('../../src/services/stack-client.js', () => ({
  default: {
    initialized: true,
    init: vi.fn(() => Promise.resolve()),
    onChanged: () => () => {},
    translate: vi.fn(),
    ocr: { recognize: vi.fn() },
  },
}));

// Vault helpers talk to safeStorage over IPC; identity stubs keep the
// settings-load path pure in jsdom.
vi.mock('../../src/utils/ocr-key-vault.js', () => ({
  migrateLegacyOcrSecrets: vi.fn(() => Promise.resolve()),
  decryptOcrSecrets: vi.fn(async (ocr) => ocr),
  encryptOcrSecrets: vi.fn(async (ocr) => ocr),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key, fallback) => (typeof fallback === 'string' ? fallback : _key), i18n: { language: 'zh' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const SettingsPanel = (await import('../../src/components/SettingsPanel/index.jsx')).default;

beforeEach(() => {
  window.electron = undefined;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('SettingsPanel mounts', () => {
  it('renders the panel shell without throwing', () => {
    const { container } = render(<SettingsPanel showNotification={() => {}} />);
    expect(container.querySelector('.settings-panel')).toBeTruthy();
  });

  it('renders the section nav', () => {
    const { container } = render(<SettingsPanel showNotification={() => {}} />);
    expect(container.querySelector('.settings-nav')).toBeTruthy();
  });

  it('honors initialSection without crashing on a non-default section', () => {
    const { container } = render(
      <SettingsPanel showNotification={() => {}} initialSection="ocr" onSectionConsumed={() => {}} />
    );
    expect(container.querySelector('.settings-panel')).toBeTruthy();
  });
});
