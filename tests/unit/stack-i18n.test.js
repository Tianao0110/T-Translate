// Stack i18n: the standalone i18next instance over the shared locale tables.
// Guards the migration pivot (strings translated in the main process instead
// of error codes over IPC): per-call language resolution, {{param}}
// interpolation, and the "missing key -> Chinese fallback" contract that all
// provider/service error sites rely on.

import { describe, it, expect } from 'vitest';
import { _t } from '../../src/stack/i18n.js';
import { configureRuntime } from '../../src/stack/runtime.js';

describe('stack i18n', () => {
  it('resolves zh by default', () => {
    configureRuntime({ getLanguage: () => 'zh' });
    const r = _t('providerError.connectSuccess', '连接成功');
    expect(typeof r).toBe('string');
    expect(r.length).toBeGreaterThan(0);
    // zh table should agree with the Chinese fallback for this stable key
    expect(r).toBe('连接成功');
  });

  it('switches language per call via getLanguage', () => {
    configureRuntime({ getLanguage: () => 'en' });
    const en = _t('providerError.connectSuccess', '连接成功');
    configureRuntime({ getLanguage: () => 'zh' });
    const zh = _t('providerError.connectSuccess', '连接成功');
    expect(en).not.toBe(zh);
    expect(en.toLowerCase()).toContain('connect');
  });

  it('interpolates {{params}}', () => {
    configureRuntime({ getLanguage: () => 'zh' });
    const r = _t('providerError.connectedModels', `连接成功，检测到 3 个模型`, { count: 3 });
    expect(r).toContain('3');
  });

  it('falls back to the provided Chinese string on a missing key', () => {
    configureRuntime({ getLanguage: () => 'en' });
    expect(_t('providerError.__definitely_missing__', '兜底文案')).toBe('兜底文案');
  });
});
