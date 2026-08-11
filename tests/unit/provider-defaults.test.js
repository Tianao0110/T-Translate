// What a fresh install can actually translate with.
//
// Regression: the default enabled set was "whatever sits first in the display
// order", which is OpenAI — unusable without a paid key. A new user who saved
// any setting from any tab persisted that list and lost translation entirely,
// with an error that named no cause.

import { describe, it, expect } from 'vitest';
import { buildDefaultProviderList, DEFAULT_ENABLED_PROVIDERS } from '../../src/components/ProviderSettings/defaults.js';
import { DEFAULT_PRIORITY } from '../../src/stack/registry.js';
import { getAllProviderMetadata } from '../../src/config/provider-icons.js';
import { PROVIDER_METADATA } from '../../src/stack/providers/metadata.js';

const META = getAllProviderMetadata();

// Needs the user to go get something (an API key) before it can work. A
// required field that ships a default — the local endpoints — does not count:
// the default is written into the config, so isProviderConfigured passes at
// runtime (providers/base.js isConfigured).
function needsSetup(id) {
  const schema = PROVIDER_METADATA[id]?.configSchema || {};
  return Object.values(schema).some(field => field.required && !field.default);
}

describe('fresh-install provider defaults', () => {
  const list = buildDefaultProviderList(META);
  const enabled = list.filter(p => p.enabled).map(p => p.id);

  it('enables at least one provider that works with zero configuration', () => {
    expect(enabled.some(id => !needsSetup(id))).toBe(true);
  });

  it('never defaults to a provider that demands a paid key', () => {
    // The actual bug: OpenAI was the sole enabled default.
    for (const id of enabled) {
      if (needsSetup(id)) {
        throw new Error(`${id} requires setup but is enabled by default`);
      }
    }
  });

  it('keeps local models ahead of the cloud fallback', () => {
    const priorityOf = (id) => list.find(p => p.id === id)?.priority ?? Infinity;
    expect(priorityOf('local-llm')).toBeLessThan(priorityOf('google-translate'));
    expect(priorityOf('ollama')).toBeLessThan(priorityOf('google-translate'));
  });

  it('lists every known provider exactly once, with dense priorities', () => {
    const ids = list.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(META.map(m => m.id).sort());
    expect(list.map(p => p.priority)).toEqual(list.map((_, i) => i));
  });

  it('drops defaults the build does not ship', () => {
    const list = buildDefaultProviderList([{ id: 'google-translate' }, { id: 'deepl' }]);
    expect(list.filter(p => p.enabled).map(p => p.id)).toEqual(['google-translate']);
    expect(list.map(p => p.id)).toEqual(['google-translate', 'deepl']);
  });

  it('survives an empty catalog', () => {
    expect(buildDefaultProviderList([])).toEqual([]);
    expect(buildDefaultProviderList(undefined)).toEqual([]);
  });
});

describe('stack fallback chain agrees with the fresh-install defaults', () => {
  it('orders the defaults the same way', () => {
    const inChain = DEFAULT_PRIORITY.normal.filter(id => DEFAULT_ENABLED_PROVIDERS.includes(id));
    expect(inChain).toEqual(DEFAULT_ENABLED_PROVIDERS);
  });

  it('reaches a zero-setup provider before any that needs a key', () => {
    const firstUsable = DEFAULT_PRIORITY.normal.findIndex(id => !needsSetup(id));
    const firstNeedingKey = DEFAULT_PRIORITY.normal.findIndex(id => needsSetup(id));
    expect(firstUsable).toBeGreaterThanOrEqual(0);
    expect(firstUsable).toBeLessThan(firstNeedingKey);
  });
});
