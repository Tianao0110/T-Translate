// The policy table as code: each numbered rule fires on the right numbers
// and nothing else, streaks reset when the process or the model changes.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createLlmPolicy, DEFAULT_THRESHOLDS } = require('../../electron/policy/engine-policy.js');

const ev = (kind, extra = {}) => ({ engine: 'llm', host: 'llm', kind, at: 1, ...extra });

describe('llm engine policy', () => {
  it('ignores other engines', () => {
    const p = createLlmPolicy();
    expect(p.observe({ engine: 'ocr', kind: 'request', stop: 'stall' })).toEqual([]);
    expect(p.state().consecutiveStalls).toBe(0);
  });

  it('P4: a slow self-test only advises', () => {
    const p = createLlmPolicy();
    expect(p.observe(ev('health', { ok: true, tokPerSec: 5 }))).toEqual([{ rule: 'P4', action: 'advise', advice: 'slow', tokPerSec: 5, floor: DEFAULT_THRESHOLDS.slowTokPerSec }]);
    expect(p.state().advice).toEqual(['slow']);
    expect(p.observe(ev('health', { ok: true, tokPerSec: 30 }))).toEqual([]);
    expect(p.state().advice).toEqual([]);
    expect(p.state().baselineTokPerSec).toBe(30);
  });

  it('P5/P6: three stalls in a row mark the session unhealthy, a good run resets the streak', () => {
    const p = createLlmPolicy();
    p.observe(ev('request', { stop: 'stall' }));
    p.observe(ev('request', { stop: 'eog', tokPerSec: 20 }));
    p.observe(ev('request', { stop: 'stall' }));
    p.observe(ev('request-failed', { code: 'LLM_TIMEOUT' }));
    expect(p.state().unhealthy).toBe(false);
    const actions = p.observe(ev('request', { stop: 'stall' }));
    expect(actions.map((a) => a.rule)).toEqual(['P5', 'P6']);
    expect(p.state()).toMatchObject({ unhealthy: true, consecutiveStalls: 3, stalls: 4 });
    expect(p.state().advice).toContain('unhealthy');
  });

  it('a host exit or a new model clears the streaks but not the totals', () => {
    const p = createLlmPolicy();
    for (let i = 0; i < 3; i++) p.observe(ev('request', { stop: 'stall' }));
    expect(p.state().unhealthy).toBe(true);
    p.observe(ev('exit', { code: 1, expected: false }));
    expect(p.state()).toMatchObject({ unhealthy: false, consecutiveStalls: 0, stalls: 3 });
    for (let i = 0; i < 3; i++) p.observe(ev('request', { stop: 'stall' }));
    p.observe(ev('model-loaded', { file: 'x' }));
    expect(p.state().unhealthy).toBe(false);
  });

  it('P9: three runs under half the baseline record a performance drop', () => {
    const p = createLlmPolicy();
    p.observe(ev('health', { ok: true, tokPerSec: 100 }));
    p.observe(ev('request', { stop: 'eog', tokPerSec: 40 }));
    p.observe(ev('request', { stop: 'eog', tokPerSec: 40 }));
    expect(p.state().perfDrop).toBe(false);
    const actions = p.observe(ev('request', { stop: 'eog', tokPerSec: 40 }));
    expect(actions).toEqual([{ rule: 'P9', action: 'record', advice: 'perf-drop', tokPerSec: 40, baseline: 100 }]);
    expect(p.state().advice).toEqual(['perf-drop']);
    p.observe(ev('request', { stop: 'eog', tokPerSec: 90 }));
    expect(p.state().perfDrop).toBe(false);
  });

  it('P13: leaked thoughts are counted', () => {
    const p = createLlmPolicy();
    expect(p.observe(ev('request', { stop: 'eog', thinkLeak: 2 }))).toEqual([{ rule: 'P13', action: 'count', thinkLeak: 2, total: 2 }]);
    p.observe(ev('request', { stop: 'eog', thinkLeak: 1 }));
    expect(p.state().thinkLeaks).toBe(3);
  });

  it('thresholds can be tuned and reset clears everything', () => {
    const p = createLlmPolicy({ thresholds: { stallLimit: 1 } });
    expect(p.observe(ev('request', { stop: 'stall' })).map((a) => a.rule)).toEqual(['P5', 'P6']);
    p.reset();
    expect(p.state()).toMatchObject({ unhealthy: false, stalls: 0, thinkLeaks: 0, baselineTokPerSec: null });
  });
});
