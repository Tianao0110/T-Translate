// Renderer logging used to be console-only: a React crash, an unhandled
// rejection or a window.onerror left nothing on disk, so every renderer bug
// had to be reproduced live to be seen at all. warn/error now mirror to the
// main-process log through the preload bridge.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let writes;

beforeEach(() => {
  writes = [];
  vi.stubGlobal('window', { electron: { logs: { write: (p) => writes.push(p) } } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function freshLogger(scope) {
  vi.resetModules();
  const { default: createLogger } = await import('../../src/utils/logger.js');
  return createLogger(scope);
}

describe('renderer log forwarding', () => {
  it('sends error and warn, keeps debug/info local', async () => {
    const log = await freshLogger('HistoryPanel');

    log.error('boom');
    log.warn('careful');
    log.debug('noise');
    log.info('noise');

    expect(writes.map(w => w.level)).toEqual(['error', 'warn']);
    expect(writes[0]).toMatchObject({ scope: 'HistoryPanel', text: 'boom' });
  });

  it('keeps the stack of an Error — the only part worth logging', async () => {
    const log = await freshLogger('Test');
    const err = new Error('kaboom');

    log.error('React error:', err);

    expect(writes[0].text).toContain('kaboom');
    expect(writes[0].text).toContain('renderer-log-forward.test');  // a stack frame
  });

  it('does not reduce a plain object to {}', async () => {
    const log = await freshLogger('Test');
    log.error('payload:', { a: 1 });
    expect(writes[0].text).toContain('{"a":1}');
  });

  it('survives a window without the bridge', async () => {
    vi.stubGlobal('window', {});
    const log = await freshLogger('Test');
    expect(() => log.error('still fine')).not.toThrow();
  });
});
