// The built-in model settings section against a fake preload bridge: the
// engine card reflects the folder scan, the pack choice persists through
// the settings bucket and the store, the developer door reveals the
// unlisted files with probe + report, and no bridge at all still renders.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, vars) => (vars ? `${key}:${Object.values(vars).join(',')}` : key),
    i18n: { language: 'zh' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const LlmSection = (await import('../../src/components/SettingsPanel/sections/LlmSection.jsx')).default;

const STATUS = {
  ready: true,
  dir: 'D:/models/llm-models',
  packs: {
    packs: [
      { id: 'qwen3-1.7b', role: 'general', name: 'Qwen3-1.7B', file: 'Qwen3-1.7B-Q8_0.gguf', size: 1834426016, status: 'ready', license: { name: 'Apache-2.0' }, source: { url: 'https://hf/x', mirror: 'https://mirror/x' } },
      { id: 'hy-mt2-1.8b', role: 'mt', name: 'Hy-MT2-1.8B', file: 'Hy-MT2-1.8B-Q8_0.gguf', size: 1908528192, status: 'missing', license: { name: 'Apache-2.0' }, source: { url: 'https://hf/y', mirror: 'https://mirror/y' } },
    ],
    unlisted: [{ file: 'Stranger.gguf', size: 900000000 }],
  },
  selected: { id: 'qwen3-1.7b', role: 'general', name: 'Qwen3-1.7B', status: 'ready' },
  scanning: false,
  provider: 'gpu',
  resident: { file: 'Qwen3-1.7B-Q8_0.gguf', provider: 'gpu', device: 'Vulkan0', fallback: null, trial: false },
  lastHealth: { ok: true, tokPerSec: 210 },
  lastRequest: null,
};

function bridge(overrides = {}) {
  return {
    status: vi.fn(async () => STATUS),
    rescan: vi.fn(async () => STATUS),
    openDir: vi.fn(async () => ({ success: true })),
    unload: vi.fn(async () => ({ success: true })),
    selfTest: vi.fn(async () => ({ success: true, ok: true, tokPerSec: 200 })),
    probe: vi.fn(async () => ({ success: true, report: { verdict: 'usable', steps: [{ name: 'metadata', ok: true, ms: 27 }] } })),
    trialReport: vi.fn(async () => ({ loads: 1, requests: 3, failures: 0, stalls: 0, empty: 0, loops: 0, thinkLeaks: 0, tokPerSecAvg: 20 })),
    ...overrides,
  };
}

function mount({ settings = { llm: { pack: 'qwen3-1.7b', allowUnlistedModels: false, trialLogText: false } }, llm = bridge() } = {}) {
  const updateSetting = vi.fn();
  const notify = vi.fn();
  const store = { set: vi.fn() };
  window.electron = { llm, store, tengine: { onEvent: () => () => {} }, shell: { openExternal: vi.fn() } };
  const utils = render(<LlmSection settings={settings} updateSetting={updateSetting} notify={notify} />);
  return { ...utils, updateSetting, notify, store, llm };
}

beforeEach(() => {
  window.electron = undefined;
});
afterEach(() => {
  cleanup();
});

describe('LlmSection', () => {
  it('renders the card from the folder scan', async () => {
    const { container, findByText } = mount();
    await findByText('llm.engineNameWith:Qwen3-1.7B');
    expect(container.querySelector('.engine-badge.installed')).toBeTruthy();
    expect(container.textContent).toContain('D:/models/llm-models');
    // The runtime block lives on the providers page now.
    expect(container.textContent).not.toContain('llm.run.title');
    // Both packs are offered; the missing one is still selectable.
    expect(container.querySelectorAll('.seg button')).toHaveLength(2);
  });

  it('switching the pack persists to the bucket and the store', async () => {
    const { container, findByText, updateSetting, store, notify } = mount();
    await findByText('llm.engineNameWith:Qwen3-1.7B');
    const buttons = container.querySelectorAll('.seg button');
    fireEvent.click(buttons[1]);
    expect(updateSetting).toHaveBeenCalledWith('llm', 'pack', 'hy-mt2-1.8b', true);
    expect(store.set).toHaveBeenCalledWith('settings.llm.pack', 'hy-mt2-1.8b');
    expect(notify).toHaveBeenCalledWith('llm.packChanged:Hy-MT2-1.8B', 'success');
  });

  it('shows download links and the how-to when the selected pack is missing', async () => {
    const { container, findByText } = mount({ settings: { llm: { pack: 'hy-mt2-1.8b' } } });
    await findByText('llm.engineNameWith:Hy-MT2-1.8B');
    expect(container.querySelector('.engine-badge.download')).toBeTruthy();
    expect(container.textContent).toContain('llm.howTo');
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent.includes('llm.linkOfficial')));
    expect(window.electron.shell.openExternal).toHaveBeenCalledWith('https://hf/y');
  });

  it('lists unlisted files even with the door closed, without actions', async () => {
    const { container, findByText } = mount();
    await findByText('Stranger.gguf');
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'llm.dev.probe')).toBe(false);
  });

  it('the developer door lists unlisted files with probe and report', async () => {
    const { container, findByText, llm } = mount({ settings: { llm: { pack: 'qwen3-1.7b', allowUnlistedModels: true } } });
    await findByText('Stranger.gguf');
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'llm.dev.probe'));
    await waitFor(() => expect(llm.probe).toHaveBeenCalledWith('Stranger.gguf'));
    await findByText('llm.dev.probeUsable');
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'llm.dev.report'));
    await waitFor(() => expect(llm.trialReport).toHaveBeenCalledWith('Stranger.gguf'));
    await waitFor(() => expect(container.textContent).toContain('llm.dev.reportLine:1,3,0,0,0,0,0,20'));
  });

  it('renders without a bridge', () => {
    window.electron = undefined;
    const { container } = render(<LlmSection settings={{ llm: {} }} updateSetting={() => {}} notify={() => {}} />);
    expect(container.querySelector('.setting-content')).toBeTruthy();
    expect(container.textContent).toContain('llm.description');
  });
});
