// The main-process listen translator: numbering, per-final translation with
// context and throttled streaming, the same-language skip, failure
// settling, and the subtitle file at session end (with and without a
// translation still in flight).

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createListenTranslator, buildSrt } = require('../../electron/managers/listen-translator.js');

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const rec = (text, lang = 'zh', start = 0) => ({ segStartS: start, segDurS: 2, lang: `<|${lang}|>`, text });
const flush = () => new Promise((r) => setTimeout(r, 0));

function make(overrides = {}) {
  const events = [];
  const saved = [];
  const stream = vi.fn(async (text, options, onChunk) => {
    onChunk(`T(${text.slice(0, 3)}`);
    await flush();
    onChunk(`T(${text})`);
    return { success: true, text: `T(${text})` };
  });
  const t = createListenTranslator({
    translateStream: stream,
    uiLang: () => 'zh',
    autosave: async (content, name, meta) => { saved.push({ content, name, meta }); return `C:/x/${name}.srt`; },
    emit: (kind, payload) => events.push({ kind, ...payload }),
    logger: quiet,
    settleMs: 50,
    paintEveryMs: 0,
    ...overrides,
  });
  return { t, events, saved, stream };
}

describe('listen translator', () => {
  it('numbers finals, translates with the previous two lines as context, streams then settles', async () => {
    const { t, events, stream } = make();
    t.beginSession({ targetLang: 'en', sourceName: 'chrome.exe' });
    const a = t.onSegment(rec('一'));
    const b = t.onSegment(rec('二'));
    const c = t.onSegment(rec('三'));
    expect([a.id, b.id, c.id]).toEqual([1, 2, 3]);
    await flush(); await flush();
    expect(stream).toHaveBeenCalledTimes(3);
    const third = stream.mock.calls[2];
    expect(third[0]).toBe('三');
    expect(third[1].targetLang).toBe('en');
    expect(third[1].systemPrompt.content).toContain('- 一');
    expect(third[1].systemPrompt.content).toContain('- 二');
    expect(third[3]).toMatchObject({ noCache: true });
    const forOne = events.filter((e) => e.kind === 'translation' && e.id === 1).map((e) => [e.text, e.done]);
    expect(forOne[0]).toEqual(['pending', false]);
    expect(forOne.at(-1)).toEqual(['T(一)', true]);
    expect(t.status()).toMatchObject({ active: true, lines: 3, inflight: 0 });
  });

  it('skips lines already in the target language and when no target is set', async () => {
    const { t, events, stream } = make();
    t.beginSession({ targetLang: 'zh' });
    t.onSegment(rec('已经是中文', 'zh'));
    t.setTarget('');
    t.onSegment(rec('anything', 'en'));
    await flush();
    expect(stream).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('settles a failed or rejected translation as null', async () => {
    const { t, events } = make({ translateStream: vi.fn(async () => ({ success: false, error: 'nope' })) });
    t.beginSession({ targetLang: 'en' });
    t.onSegment(rec('x'));
    await flush(); await flush();
    expect(events.at(-1)).toMatchObject({ id: 1, text: null, done: true });
    const thrown = make({ translateStream: vi.fn(async () => { throw new Error('boom'); }) });
    thrown.t.beginSession({ targetLang: 'en' });
    thrown.t.onSegment(rec('y'));
    await flush(); await flush();
    expect(thrown.events.at(-1)).toMatchObject({ id: 1, text: null, done: true });
  });

  it('files the transcript with settled translations when the session ends, once', async () => {
    const { t, events, saved } = make();
    t.beginSession({ targetLang: 'en', sourceName: 'vlc.exe' });
    t.onSegment(rec('一', 'zh', 0));
    t.onSegment(rec('二', 'zh', 2.5));
    await flush(); await flush(); await flush();
    const file = await t.endSession('stopped');
    expect(file).toBe('C:/x/vlc.exe.srt');
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('vlc.exe');
    expect(saved[0].content).toBe('1\n00:00:00,000 --> 00:00:02,000\n一\nT(一)\n\n2\n00:00:02,500 --> 00:00:04,500\n二\nT(二)\n');
    expect(events.at(-1)).toMatchObject({ kind: 'autosaved', filePath: file, lines: 2, reason: 'stopped' });
    expect(await t.endSession('again')).toBeNull();
    expect(saved).toHaveLength(1);
  });

  it('waits briefly for a translation in flight, then files without it', async () => {
    let release;
    const slow = vi.fn(() => new Promise((r) => { release = r; }));
    const { t, saved } = make({ translateStream: slow, settleMs: 20 });
    t.beginSession({ targetLang: 'en' });
    t.onSegment(rec('慢'));
    await flush();
    const file = await t.endSession('closed');
    expect(file).toBe('C:/x/.srt');
    expect(saved[0].content).toBe('1\n00:00:00,000 --> 00:00:02,000\n慢\n');
    release({ success: true, text: 'late' });
  });

  it('records nothing and translates nothing outside a session', async () => {
    const { t, stream } = make();
    t.onSegment(rec('孤儿'));
    await flush();
    expect(stream).not.toHaveBeenCalled();
    expect(t.status().lines).toBe(0);
    expect(await t.endSession('x')).toBeNull();
  });

  it('buildSrt leaves out pending and null translations', () => {
    const srt = buildSrt([
      { startS: 1, durS: 1, text: 'a', trans: 'pending' },
      { startS: 3, durS: 1.25, text: 'b', trans: null },
      { startS: 5, durS: 0.5, text: 'c', trans: 'C' },
    ]);
    expect(srt).toBe('1\n00:00:01,000 --> 00:00:02,000\na\n\n2\n00:00:03,000 --> 00:00:04,250\nb\n\n3\n00:00:05,000 --> 00:00:05,500\nc\nC\n');
  });
});
