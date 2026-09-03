// "Nothing translates on a fresh install" is the failure this answers, so the
// answer has to match what the Translate button will actually do — it is built
// on the same three filters the translate path uses.
//
// The trap it exists to avoid: isConfigured() is not evidence for a local
// provider. Local providers declare no required config fields, so they report
// configured whether or not anything is listening on the port.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  priority: [],
  allowed: () => true,
  providers: {},
};

vi.mock('../../src/stack/registry.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getProvider: (id) => state.providers[id],
  isProviderConfigured: (id) => state.providers[id]?.isConfigured?.() ?? false,
}));

vi.mock('../../src/stack/privacy-modes.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isProviderAllowed: (id, mode) => state.allowed(id, mode) };
});

const { TranslationService } = await import('../../src/stack/service.js');

const cloud = (configured) => ({
  requiresNetwork: true,
  isConfigured: () => configured,
  testConnection: vi.fn(),
});

const local = (reachable) => ({
  requiresNetwork: false,
  // The whole point: a local provider always says it is configured.
  isConfigured: () => true,
  testConnection: vi.fn().mockResolvedValue({ success: reachable }),
});

function service() {
  const s = new TranslationService({});
  s.getPriority = () => state.priority;
  return s;
}

beforeEach(() => {
  state.priority = [];
  state.allowed = () => true;
  state.providers = {};
});

describe('getTranslationReadiness', () => {
  it('is not ready with no providers at all', async () => {
    expect(await service().getTranslationReadiness()).toMatchObject({
      ready: false, reason: 'no-provider', candidates: 0,
    });
  });

  it('is ready on a cloud provider that has a key — without probing it', async () => {
    state.priority = ['openai'];
    state.providers = { openai: cloud(true) };

    const result = await service().getTranslationReadiness();

    expect(result).toMatchObject({ ready: true, reason: 'cloud' });
    // Probing here would spend the user's quota on every launch.
    expect(state.providers.openai.testConnection).not.toHaveBeenCalled();
  });

  it('is not ready on a cloud provider with no key', async () => {
    state.priority = ['openai'];
    state.providers = { openai: cloud(false) };

    expect(await service().getTranslationReadiness()).toMatchObject({
      ready: false, reason: 'no-provider',
    });
  });

  it('probes a local provider, because configured tells us nothing there', async () => {
    state.priority = ['local-llm'];
    state.providers = { 'local-llm': local(true) };

    const result = await service().getTranslationReadiness();

    expect(result).toMatchObject({ ready: true, reason: 'local' });
    expect(state.providers['local-llm'].testConnection).toHaveBeenCalled();
  });

  it('is not ready when the only local provider is not running', async () => {
    state.priority = ['local-llm'];
    state.providers = { 'local-llm': local(false) };

    expect(await service().getTranslationReadiness()).toMatchObject({
      ready: false, reason: 'local-unreachable', candidates: 1,
    });
  });

  it('tries every local provider before giving up', async () => {
    state.priority = ['local-llm', 'ollama'];
    state.providers = { 'local-llm': local(false), 'ollama': local(true) };

    expect(await service().getTranslationReadiness()).toMatchObject({ ready: true });
  });

  it('treats a throwing probe as unreachable, not as a crash', async () => {
    state.priority = ['local-llm'];
    state.providers = {
      'local-llm': { requiresNetwork: false, isConfigured: () => true,
        testConnection: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
    };

    expect(await service().getTranslationReadiness()).toMatchObject({
      ready: false, reason: 'local-unreachable',
    });
  });

  it('respects the privacy allowlist — an offline mode hides cloud providers', async () => {
    state.priority = ['openai', 'local-llm'];
    state.providers = { openai: cloud(true), 'local-llm': local(false) };
    state.allowed = (id) => id !== 'openai';

    const result = await service().getTranslationReadiness('offline');

    expect(result).toMatchObject({ ready: false, reason: 'local-unreachable', candidates: 1 });
  });

  it('takes the cloud answer without probing a local provider ahead of it', async () => {
    // A configured cloud provider anywhere in the chain means translation
    // works; walking further would only cost time.
    state.priority = ['openai', 'local-llm'];
    state.providers = { openai: cloud(true), 'local-llm': local(false) };

    expect(await service().getTranslationReadiness()).toMatchObject({ ready: true });
    expect(state.providers['local-llm'].testConnection).not.toHaveBeenCalled();
  });
});

// Offline mode promises no network traffic. A local provider whose endpoint
// was pointed at another machine is network traffic, so the gate treats it as
// unusable — and says so, because the fix (edit the address) differs from
// "add a provider".
describe('offline mode: local providers must point at this machine', () => {
  const localAt = (endpoint, reachable = true) => ({
    requiresNetwork: false,
    isConfigured: () => true,
    config: { endpoint },
    testConnection: vi.fn().mockResolvedValue({ success: reachable }),
  });

  beforeEach(() => {
    state.allowed = (id) => id === 'local-llm' || id === 'ollama';
  });

  it('refuses a LAN endpoint and names the reason', async () => {
    state.priority = ['ollama'];
    state.providers = { ollama: localAt('http://192.168.1.20:11434/v1') };

    expect(await service().getTranslationReadiness('offline')).toMatchObject({
      ready: false, reason: 'offline-remote-endpoint', candidates: 0,
    });
    expect(state.providers.ollama.testConnection).not.toHaveBeenCalled();
  });

  it('accepts localhost, 127.0.0.1 and an empty (default) endpoint', async () => {
    state.priority = ['local-llm', 'ollama'];
    state.providers = {
      'local-llm': localAt('http://127.0.0.1:1234/v1'),
      ollama: localAt(''),
    };

    expect(await service().getTranslationReadiness('offline')).toMatchObject({ ready: true, reason: 'local' });
  });

  it('only applies offline — the same LAN endpoint is fine in standard mode', async () => {
    state.priority = ['ollama'];
    state.providers = { ollama: localAt('http://192.168.1.20:11434/v1') };

    expect(await service().getTranslationReadiness('standard')).toMatchObject({ ready: true, reason: 'local' });
  });

  it('keeps the remote provider out of the translate chain offline', () => {
    state.priority = ['ollama', 'local-llm'];
    state.providers = {
      ollama: localAt('http://10.0.0.5:11434/v1'),
      'local-llm': localAt('http://localhost:1234/v1'),
    };
    const s = service();

    expect(s.providerGate('ollama', 'offline')).toBe('offline-remote-endpoint');
    expect(s.providerGate('local-llm', 'offline')).toBeNull();
    expect(s.providerGate('ollama', 'standard')).toBeNull();
  });
});
