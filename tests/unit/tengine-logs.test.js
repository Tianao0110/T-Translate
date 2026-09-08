// The two log sinks under data\logs: the metrics log (numbers only, last
// few days, nothing in secure mode) and the trial log (per model per month,
// two-month retention, text only behind the switch, summarised into the
// trial report).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { createMetricsLog, scrub } = require('../../electron/tengine/metrics-log.js');
const { createTrialLog, pruneTrialLogs, summarizeTrialLogs, trialFileName } = require('../../electron/tengine/trial-log.js');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-tengine-logs-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;
const lines = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

describe('metrics log', () => {
  it('writes one line per event and keeps text out', () => {
    let t = Date.UTC(2026, 8, 8, 12);
    const m = createMetricsLog({ dir, now: () => t });
    expect(m.write({ engine: 'llm', kind: 'request', genTokens: 12, text: '秘密', prompt: 'p', nested: { user: 'u', tokPerSec: 3 } })).toBe(true);
    t += 1000;
    m.write({ engine: 'ocr', kind: 'ready', readyMs: 300, long: 'x'.repeat(500) });
    const rows = lines(path.join(dir, 'tengine-2026-09-08.jsonl'));
    expect(rows[0]).toEqual({ engine: 'llm', kind: 'request', genTokens: 12, nested: { tokPerSec: 3 }, at: Date.UTC(2026, 8, 8, 12) });
    expect(rows[1].long.length).toBe(201);
    expect(m.recent(1)[0].kind).toBe('ready');
  });

  it('writes nothing to disk in secure mode but keeps the ring', () => {
    let secure = true;
    const m = createMetricsLog({ dir, isSecure: () => secure });
    expect(m.write({ kind: 'a' })).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(m.recent()).toHaveLength(1);
    expect(m.path()).toBeNull();
    secure = false;
    expect(m.write({ kind: 'b' })).toBe(true);
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  it('keeps only the last three days of files', () => {
    for (const d of ['2026-09-01', '2026-09-02', '2026-09-03']) fs.writeFileSync(path.join(dir, `tengine-${d}.jsonl`), '');
    fs.writeFileSync(path.join(dir, 'tengine-trial-x-2026-09.jsonl'), '');
    const m = createMetricsLog({ dir, now: () => Date.UTC(2026, 8, 8) });
    m.write({ kind: 'x' });
    expect(fs.readdirSync(dir).sort()).toEqual(['tengine-2026-09-02.jsonl', 'tengine-2026-09-03.jsonl', 'tengine-2026-09-08.jsonl', 'tengine-trial-x-2026-09.jsonl']);
  });

  it('scrub drops content keys at any depth', () => {
    expect(scrub({ a: 1, messages: [{ role: 'user' }], deep: { image: 'x', n: 2 } })).toEqual({ a: 1, deep: { n: 2 } });
  });
});

describe('trial log', () => {
  const now = () => Date.UTC(2026, 8, 8, 9);

  it('names the file per model and month and writes text only with the switch', () => {
    let text = false;
    const log = createTrialLog({ dir, modelFile: 'Stranger Q4.gguf', now, logText: () => text });
    expect(path.basename(log.path())).toBe('tengine-trial-Stranger_Q4-2026-09.jsonl');
    expect(trialFileName('a/b.gguf', now)).toBe('tengine-trial-a_b-2026-09.jsonl');
    log.write({ kind: 'request', genTokens: 3, text: { output: '秘密' } });
    text = true;
    log.write({ kind: 'request', genTokens: 4, text: { output: '可见' } });
    const rows = lines(log.path());
    expect(rows[0]).toEqual({ at: now(), model: 'Stranger Q4.gguf', kind: 'request', genTokens: 3 });
    expect(rows[1].text).toEqual({ output: '可见' });
  });

  it('writes nothing in secure mode', () => {
    const log = createTrialLog({ dir, modelFile: 'x.gguf', now, isSecure: () => true });
    expect(log.write({ kind: 'request' })).toBe(false);
    expect(fs.existsSync(log.path())).toBe(false);
  });

  it('prunes files older than two months by mtime', () => {
    const old = path.join(dir, 'tengine-trial-old-2026-06.jsonl');
    const fresh = path.join(dir, 'tengine-trial-new-2026-09.jsonl');
    const other = path.join(dir, 'tengine-2026-06-01.jsonl');
    for (const f of [old, fresh, other]) fs.writeFileSync(f, '');
    const t = Date.UTC(2026, 8, 8);
    fs.utimesSync(old, new Date(t - 70 * DAY), new Date(t - 70 * DAY));
    fs.utimesSync(other, new Date(t - 70 * DAY), new Date(t - 70 * DAY));
    expect(pruneTrialLogs({ dir, now: () => t })).toEqual(['tengine-trial-old-2026-06.jsonl']);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
    expect(pruneTrialLogs({ dir: path.join(dir, 'nope'), now: () => t })).toEqual([]);
  });

  it('summarises every line of a model into the trial report', () => {
    const log = createTrialLog({ dir, modelFile: 'S.gguf', now });
    log.write({ kind: 'model-loaded', loadMs: 300, rss: 500 });
    log.write({ kind: 'request', genTokens: 10, tokPerSec: 20, firstMs: 100, stop: 'eog', thinkLeak: 1, rss: 900 });
    log.write({ kind: 'request', genTokens: 0, tokPerSec: null, firstMs: 50, stop: 'limit' });
    log.write({ kind: 'request', genTokens: 40, tokPerSec: 30, stop: 'loop' });
    log.write({ kind: 'request', genTokens: 5, tokPerSec: 25, stop: 'stall' });
    log.write({ kind: 'request-failed', code: 'LLM_HOST_CRASHED' });
    log.write({ kind: 'probe', verdict: 'usable' });
    const s = summarizeTrialLogs({ dir, modelFile: 'S.gguf' });
    expect(s).toMatchObject({ model: 'S.gguf', loads: 1, requests: 4, failures: 1, stalls: 1, loops: 1, noEog: 1, empty: 1, thinkLeaks: 1, tokPerSecAvg: 25, firstMsAvg: 75, rssPeak: 900, probes: 1, lastProbeVerdict: 'usable' });
    expect(s.files).toEqual(['tengine-trial-S-2026-09.jsonl']);
    expect(summarizeTrialLogs({ dir, modelFile: 'none.gguf' }).requests).toBe(0);
  });
});
