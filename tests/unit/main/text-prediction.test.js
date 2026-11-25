// Word completion through the Windows typing predictor: which text is asked
// about, which answer is shown, and the resident host's line protocol with a
// fake PowerShell.

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const { createTextPredictor, predictionRequest, predictionSuffix } = require('../../../electron/platform/text-prediction.js');

describe('prediction request', () => {
  it('sends the word being typed and up to eight words before it', () => {
    expect(predictionRequest('The meeting has been moved to Thur')).toEqual({ prev: ['The', 'meeting', 'has', 'been', 'moved', 'to'], fragment: 'Thur' });
    const long = predictionRequest('one two three four five six seven eight nine ten elev');
    expect(long.prev).toHaveLength(8);
    expect(long.prev[0]).toBe('three');
  });

  it('needs three letters, a word end, and English', () => {
    expect(predictionRequest('Please save your wo')).toBeNull();
    expect(predictionRequest('Let me know if ')).toBeNull();
    expect(predictionRequest('Hello,')).toBeNull();
    expect(predictionRequest('这是中文 abc')).toBeNull();
    expect(predictionRequest(null)).toBeNull();
    expect(predictionRequest('inv')).toEqual({ prev: [], fragment: 'inv' });
  });
});

describe('prediction suffix', () => {
  it('shows the rest of the best candidate, keeping what was typed', () => {
    expect(predictionSuffix(['Thursday', 'Thur'], 'Thur')).toBe('sday');
    expect(predictionSuffix(['Thursday'], 'thur')).toBe('sday');
    expect(predictionSuffix('invoice', 'invo')).toBe('ice');
  });

  it('nothing when the best candidate does not extend the word', () => {
    expect(predictionSuffix(['Thur'], 'Thur')).toBe('');
    expect(predictionSuffix(['r but'], 'Thur')).toBe('');
    expect(predictionSuffix(['feel'], 'Thur')).toBe('');
    expect(predictionSuffix(['Thursday,'], 'Thur')).toBe('');
    expect(predictionSuffix([], 'Thur')).toBe('');
    expect(predictionSuffix(null, 'Thur')).toBe('');
  });
});

// A fake powershell.exe: answers the ready line, then candidates per request.
function fakeHost({ ready = true, answer = () => ['Thursday'] } = {}) {
  const spawned = [];
  const spawnImpl = vi.fn(() => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stdin = new EventEmitter();
    child.stdin.write = (line) => {
      const req = JSON.parse(line);
      queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({ id: req.id, candidates: answer(req) })}\n`));
    };
    child.kill = vi.fn(() => queueMicrotask(() => child.emit('exit', 0)));
    queueMicrotask(() => child.stdout.emit('data', ready ? '{"ready":true}\r\n' : '{"ready":false,"error":"no data"}\r\n'));
    spawned.push(child);
    return child;
  });
  return { spawnImpl, spawned };
}

describe('resident predictor host', () => {
  it('starts once, answers each request, and passes the context words', async () => {
    const seen = [];
    const { spawnImpl } = fakeHost({ answer: (req) => (seen.push(req), ['Thursday']) });
    const p = createTextPredictor({ spawnImpl });
    expect(await p.complete('moved to Thur')).toBe('sday');
    expect(await p.complete('moved to Thurs')).toBe('day');
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(seen[0]).toMatchObject({ prev: ['moved', 'to'], fragment: 'Thur' });
    p.stop();
  });

  it('a machine without the predictor gives up once and never respawns', async () => {
    const { spawnImpl } = fakeHost({ ready: false });
    const p = createTextPredictor({ spawnImpl });
    expect(await p.complete('moved to Thur')).toBe('');
    expect(await p.complete('moved to Thur')).toBe('');
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(p.available()).toBe(false);
  });

  it('text it cannot complete never starts the host', async () => {
    const { spawnImpl } = fakeHost();
    const p = createTextPredictor({ spawnImpl });
    expect(await p.complete('Let me know if ')).toBe('');
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('stops when idle and starts again on the next request', async () => {
    vi.useFakeTimers();
    try {
      const { spawnImpl, spawned } = fakeHost();
      const p = createTextPredictor({ spawnImpl, idleMs: 1000 });
      expect(await p.warm()).toBe(true);
      await vi.advanceTimersByTimeAsync(1100);
      expect(spawned[0].kill).toHaveBeenCalled();
      expect(await p.complete('moved to Thur')).toBe('sday');
      expect(spawnImpl).toHaveBeenCalledTimes(2);
      p.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
