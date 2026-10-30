// @vitest-environment node
// fastText fetches its model over the network for any non-file URL: the
// judge must refuse such a path and carry on with ELD alone.

import { describe, it, expect, vi } from 'vitest';

const load = vi.fn();
vi.mock('fasttext.wasm.js', () => ({
  getLIDModel: async () => ({ modelPath: 'https://example.com/lid.176.ftz', load }),
}));

const { detectLanguages } = await import('../../../src/stack/language-id.js');

describe('fastText model path', () => {
  it('never loads a model that is not on disk', async () => {
    const [fr] = await detectLanguages(['Je ne sais pas ce que tu veux dire.'], 'en');
    expect(load).not.toHaveBeenCalled();
    expect(fr).toEqual({ language: 'fr', inTarget: false });
  });
});
