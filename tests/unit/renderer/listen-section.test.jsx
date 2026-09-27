// The listen settings section against fake preload bridges: the speech
// models of the high-accuracy tier come from llm:status with their per-file
// state and download links, the tier only turns high once one of them is
// usable, and the old high-accuracy pack shows up only while it is on disk,
// with its own removal question.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // A string second argument is a default value; an object is interpolation.
    t: (key, opt) => (opt && typeof opt === 'object' ? `${key}:${Object.values(opt).join(',')}` : key),
    i18n: { language: 'zh' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const ListenSection = (await import('../../../src/components/SettingsPanel/sections/ListenSection.jsx')).default;

const files = (stem, status) => [
  { part: 'model', file: `${stem}.gguf`, size: 800 * 1048576, status },
  { part: 'mmproj', file: `mmproj-${stem}.gguf`, size: 200 * 1048576, status },
];
const source = (tag) => ({ url: `https://hf/${tag}/model`, mirror: `https://mirror/${tag}/model`, mmproj: { url: `https://hf/${tag}/mmproj`, mirror: `https://mirror/${tag}/mmproj` } });

function llmStatus({ bigReady = false, smallReady = true, usable = true, selected = 'qwen3-asr-0.6b', provider = 'cpu' } = {}) {
  return {
    ready: true,
    dir: 'D:/models/llm-models',
    packs: {
      packs: [
        { id: 'qwen3-1.7b', role: 'general', name: 'Qwen3-1.7B', status: 'ready', files: files('Qwen3-1.7B', 'ready'), source: source('q') },
        { id: 'qwen3-asr-1.7b', role: 'asr', name: 'Qwen3-ASR-1.7B', status: bigReady ? 'ready' : 'missing', files: files('Qwen3-ASR-1.7B', bigReady ? 'ready' : 'missing'), source: source('big') },
        { id: 'qwen3-asr-0.6b', role: 'asr', name: 'Qwen3-ASR-0.6B', status: smallReady ? 'ready' : 'missing', files: files('Qwen3-ASR-0.6B', smallReady ? 'ready' : 'missing'), source: source('small') },
      ],
      unlisted: [],
    },
    asr: { available: true, usable, selected: usable ? selected : null, provider },
  };
}

const BASE_PACK = { id: 'asr-base-sense-voice', type: 'asr-base', status: 'installed', size: 150 * 1048576 };
const OLD_PACK = { id: 'asr-hq-qwen3-0.6b', type: 'asr-hq', status: 'installed', manual: { url: 'https://old', dir: 'old' } };

function mount({ llm = llmStatus(), tier = 'standard', packs = [BASE_PACK] } = {}) {
  const notify = vi.fn();
  const confirm = vi.fn(async () => true);
  const stored = { 'settings.listen.tier': tier, 'settings.listen.autosave': true };
  const store = { get: vi.fn(async (k) => stored[k]), set: vi.fn(async (k, v) => { stored[k] = v; }) };
  const bridges = {
    audioPacks: {
      getInfo: vi.fn(async () => ({ modelName: 'sense-voice', streamingPresent: true, hqPresent: !!llm?.asr?.usable, modelsDir: 'D:/models/asr-models' })),
      listPacks: vi.fn(async () => ({ success: true, packs })),
      onPackProgress: () => () => {},
      removePack: vi.fn(async () => ({ success: true })),
    },
    llm: { status: vi.fn(async () => llm), rescan: vi.fn(async () => llmStatus({ bigReady: true, selected: 'qwen3-asr-1.7b' })), openDir: vi.fn(async () => ({ success: true })) },
    store,
    shell: { openExternal: vi.fn() },
    floatingWindow: { notifySettingsChanged: vi.fn() },
  };
  window.electron = bridges;
  const utils = render(<ListenSection notify={notify} confirm={confirm} />);
  return { ...utils, notify, confirm, store, bridges };
}

const buttonByText = (container, text) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent.includes(text));

beforeEach(() => {
  window.electron = undefined;
});
afterEach(() => {
  cleanup();
});

describe('ListenSection — high-accuracy models', () => {
  it('lists the two speech models with per-file state and links for the one not yet placed', async () => {
    const { container, findByText, bridges } = mount();
    await findByText('Qwen3-ASR-1.7B');
    expect(container.textContent).toContain('Qwen3-ASR-0.6B');
    // The translation model is not a speech model.
    expect(Array.from(container.querySelectorAll('.engine-name')).map((n) => n.textContent)).toEqual(['Qwen3-ASR-1.7B', 'Qwen3-ASR-0.6B']);
    expect(container.textContent).toContain('listen.hq.part.mmproj: mmproj-Qwen3-ASR-1.7B.gguf · listen.hq.state.missing');
    expect(container.textContent).toContain('listen.hq.next:Qwen3-ASR-0.6B,listen.hq.where.cpu');
    // Four links for the missing pack, none for the ready one.
    expect(Array.from(container.querySelectorAll('.link-button'))).toHaveLength(4);
    fireEvent.click(buttonByText(container, 'listen.hq.linkEncoder'));
    expect(bridges.shell.openExternal).toHaveBeenCalledWith('https://hf/big/mmproj');
    fireEvent.click(buttonByText(container, 'listen.hq.mirrorModel'));
    expect(bridges.shell.openExternal).toHaveBeenCalledWith('https://mirror/big/model');
    fireEvent.click(buttonByText(container, 'listen.hq.openFolder'));
    expect(bridges.llm.openDir).toHaveBeenCalled();
  });

  it('turns the tier high only once a speech model is usable', async () => {
    const off = mount({ llm: llmStatus({ smallReady: false, usable: false }) });
    await off.findByText('Qwen3-ASR-1.7B');
    fireEvent.click(buttonByText(off.container, 'listen.tier.high'));
    await waitFor(() => expect(off.notify).toHaveBeenCalledWith('listen.hq.needPack', 'warning'));
    expect(off.store.set).not.toHaveBeenCalledWith('settings.listen.tier', 'high');
    cleanup();

    const on = mount();
    await on.findByText('Qwen3-ASR-1.7B');
    fireEvent.click(buttonByText(on.container, 'listen.tier.high'));
    await waitFor(() => expect(on.store.set).toHaveBeenCalledWith('settings.listen.tier', 'high'));
    expect(on.notify).toHaveBeenCalledWith('listen.tier.enabled', 'success');
  });

  it('says the high tier is not running when its model is gone, without changing the choice', async () => {
    const { findByText, store } = mount({ llm: llmStatus({ smallReady: false, usable: false }), tier: 'high' });
    await findByText('listen.hq.inactive');
    expect(store.set).not.toHaveBeenCalled();
  });

  it('re-detect asks the model manager again and shows what it found', async () => {
    const { container, findByText, bridges } = mount();
    await findByText('Qwen3-ASR-1.7B');
    fireEvent.click(buttonByText(container, 'listen.hq.rescan'));
    await findByText('listen.hq.next:Qwen3-ASR-1.7B,listen.hq.where.cpu');
    expect(bridges.llm.rescan).toHaveBeenCalled();
    expect(container.querySelectorAll('.link-button')).toHaveLength(0);
  });
});

describe('ListenSection — the old high-accuracy pack', () => {
  it('is listed while installed and removed after its own question', async () => {
    const { container, findByText, confirm, bridges } = mount({ packs: [BASE_PACK, OLD_PACK] });
    await findByText('listen.packs.names.asr-hq-qwen3-0.6b');
    const rows = Array.from(container.querySelectorAll('.ocr-pack-row'));
    const oldRow = rows.find((r) => r.textContent.includes('listen.packs.names.asr-hq-qwen3-0.6b'));
    fireEvent.click(oldRow.querySelector('button.uninstall'));
    await waitFor(() => expect(bridges.audioPacks.removePack).toHaveBeenCalledWith('asr-hq-qwen3-0.6b'));
    expect(confirm).toHaveBeenCalledWith('listen.packs.removeConfirmFor.asr-hq-qwen3-0.6b');
  });

  it('is not offered for download when it is not on disk', async () => {
    const { container, findByText } = mount({ packs: [BASE_PACK, { ...OLD_PACK, status: 'not-installed' }] });
    await findByText('listen.packs.names.asr-base-sense-voice');
    expect(container.textContent).not.toContain('listen.packs.names.asr-hq-qwen3-0.6b');
  });

  it('renders without a model bridge', async () => {
    const { container, findByText } = mount({ llm: null });
    await findByText('listen.packs.names.asr-base-sense-voice');
    expect(container.textContent).not.toContain('listen.hq.title');
  });
});
