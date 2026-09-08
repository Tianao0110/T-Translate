// The shared pack list with a link-only pack: the upstream link, the target
// folder and the "placed, check again" button appear while it is not
// installed; the download button stays when the manifest still has a zip.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, vars) => (vars && typeof vars === 'object' ? `${key}:${Object.values(vars).join(',')}` : key),
    i18n: { language: 'zh' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const PackList = (await import('../../src/components/SettingsPanel/sections/PackList.jsx')).default;

const MANUAL = { dir: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25', url: 'https://up/x.tar.bz2' };
const packRow = (overrides = {}) => ({
  id: 'asr-hq-qwen3-0.6b',
  type: 'asr-hq',
  version: '1.0.0',
  status: 'not-installed',
  file: 'asr-hq-qwen3-0.6b.zip',
  size: 800e6,
  manual: MANUAL,
  targetDir: 'D:/models/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25',
  ...overrides,
});

function mount(rows) {
  const bridge = {
    listPacks: vi.fn(async () => ({ success: true, packs: rows })),
    onPackProgress: () => () => {},
  };
  window.electron = { shell: { openExternal: vi.fn() } };
  const utils = render(<PackList bridge={bridge} prefix="listen.packs" notify={() => {}} confirm={async () => true} />);
  return { ...utils, bridge };
}

beforeEach(() => {
  window.electron = undefined;
});
afterEach(() => {
  cleanup();
});

describe('PackList with a link-only pack', () => {
  it('shows the link, the folder and the recheck button next to the download', async () => {
    const { container, findByText, bridge } = mount([packRow()]);
    await findByText('listen.packs.manualHint');
    expect(container.textContent).toContain('listen.packs.manualDir:D:/models/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25');
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent.includes('listen.packs.manualLink')));
    expect(window.electron.shell.openExternal).toHaveBeenCalledWith('https://up/x.tar.bz2');
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent.includes('listen.packs.download'))).toBe(true);
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent.includes('listen.packs.manualRecheck')));
    await waitFor(() => expect(bridge.listPacks).toHaveBeenLastCalledWith({ refresh: true }));
  });

  it('a link-only pack without a zip has no download button', async () => {
    const { container, findByText } = mount([packRow({ file: undefined })]);
    await findByText('listen.packs.manualHint');
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent.includes('listen.packs.download'))).toBe(false);
  });

  it('once installed the manual block is gone and uninstall remains', async () => {
    const { container, findByText } = mount([packRow({ status: 'installed', installedVersion: '1.0.0', manual: true, dir: 'D:/x' })]);
    await findByText('listen.packs.installed');
    expect(container.textContent).not.toContain('listen.packs.manualHint');
    expect(container.querySelector('.btn-small.uninstall')).toBeTruthy();
  });
});
