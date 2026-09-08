// The runtime block inside the built-in provider's card: backend, residency
// and speed from llm:status, self-test and unload through the bridge, and
// nothing at all when the manager is not ready.

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

const LlmRuntimeCard = (await import('../../src/components/SettingsPanel/sections/LlmRuntimeCard.jsx')).default;

const STATUS = {
  ready: true,
  selected: { id: 'qwen3-1.7b', role: 'general', name: 'Qwen3-1.7B', status: 'ready' },
  provider: 'gpu',
  resident: { file: 'Qwen3-1.7B-Q8_0.gguf', provider: 'gpu', device: 'Vulkan0', fallback: null, trial: false },
  lastHealth: { ok: true, tokPerSec: 210 },
  lastRequest: null,
};

function mount(status = STATUS) {
  const llm = {
    status: vi.fn(async () => status),
    selfTest: vi.fn(async () => ({ success: true, ok: true, tokPerSec: 200 })),
    unload: vi.fn(async () => ({ success: true })),
  };
  const notify = vi.fn();
  window.electron = { llm, tengine: { onEvent: () => () => {} } };
  const utils = render(<LlmRuntimeCard notify={notify} />);
  return { ...utils, llm, notify };
}

beforeEach(() => {
  window.electron = undefined;
});
afterEach(() => {
  cleanup();
});

describe('LlmRuntimeCard', () => {
  it('shows backend, residency and speed', async () => {
    const { container, findByText } = mount();
    await findByText('llm.run.backend');
    expect(container.textContent).toContain('llm.run.gpu:Vulkan0');
    expect(container.textContent).toContain('llm.run.loaded:Qwen3-1.7B-Q8_0.gguf');
    expect(container.textContent).toContain('llm.run.speedValue:210');
    expect(container.textContent).not.toContain('llm.run.slowHint');
  });

  it('flags a slow CPU run and disables unload when nothing is resident', async () => {
    const { container, findByText } = mount({ ...STATUS, provider: 'cpu', resident: null, lastHealth: { ok: true, tokPerSec: 5 } });
    await findByText('llm.run.backend');
    expect(container.textContent).toContain('llm.run.cpu');
    expect(container.textContent).toContain('llm.run.idle');
    expect(container.textContent).toContain('llm.run.slowHint');
    const unload = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'llm.run.unload');
    expect(unload.disabled).toBe(true);
  });

  it('runs the self-test and reports the number, unloads on request', async () => {
    const { container, findByText, notify, llm } = mount();
    await findByText('llm.run.backend');
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'llm.run.selfTest'));
    await waitFor(() => expect(llm.selfTest).toHaveBeenCalled());
    await waitFor(() => expect(notify).toHaveBeenCalledWith('llm.run.testOk:200', 'success'));
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'llm.run.unload'));
    await waitFor(() => expect(llm.unload).toHaveBeenCalled());
    await waitFor(() => expect(notify).toHaveBeenCalledWith('llm.run.unloaded', 'success'));
  });

  it('renders nothing when the manager is not ready or there is no bridge', async () => {
    const { container } = mount({ ready: false });
    await new Promise((r) => setTimeout(r, 5));
    expect(container.innerHTML).toBe('');
    cleanup();
    window.electron = undefined;
    const { container: c2 } = render(<LlmRuntimeCard notify={() => {}} />);
    expect(c2.innerHTML).toBe('');
  });
});
