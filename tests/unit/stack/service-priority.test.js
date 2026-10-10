// Which providers the service tries (src/stack/service.js getPriority): a
// fresh install has no saved provider list and must use the default order,
// not read as "every provider disabled". The main-process loader hands an
// empty list in that case (security/secure-vault.js).

import { describe, it, expect } from 'vitest';
import { TranslationService } from '../../../src/stack/service.js';
import { DEFAULT_PRIORITY } from '../../../src/stack/registry.js';

async function serviceWith(list) {
  const service = new TranslationService({ loadProviderConfigs: async () => ({ list, configs: {} }) });
  await service.init();
  return service;
}

describe('provider priority', () => {
  it('no saved list (fresh install) uses the default order', async () => {
    expect((await serviceWith([])).getPriority()).toEqual(DEFAULT_PRIORITY.normal);
    expect((await serviceWith(null)).getPriority()).toEqual(DEFAULT_PRIORITY.normal);
  });

  it('a saved list with every provider disabled tries none', async () => {
    const s = await serviceWith([{ id: 'tengine', enabled: false, priority: 1 }, { id: 'google-translate', enabled: false, priority: 2 }]);
    expect(s.getPriority()).toEqual([]);
  });

  it('a saved list is followed in its own order', async () => {
    const s = await serviceWith([{ id: 'google-translate', enabled: true, priority: 2 }, { id: 'tengine', enabled: true, priority: 1 }, { id: 'deepl', enabled: false, priority: 3 }]);
    expect(s.getPriority()).toEqual(['tengine', 'google-translate']);
  });

  it('reloading after the list is cleared goes back to the default order', async () => {
    let list = [{ id: 'google-translate', enabled: true, priority: 1 }];
    const s = new TranslationService({ loadProviderConfigs: async () => ({ list, configs: {} }) });
    await s.init();
    expect(s.getPriority()).toEqual(['google-translate']);
    list = [];
    await s.reload();
    expect(s.getPriority()).toEqual(DEFAULT_PRIORITY.normal);
  });
});
