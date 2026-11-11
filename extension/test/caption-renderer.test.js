// The caption renderer over a fake TextTrack (injected addTextTrack /
// createCue): set / upsert / updateText / clear, cue-markup escaping, the
// zero-length fix, the three displays, translations arriving (pending,
// partial, done, failed), the media-event glue, and track ⇄ overlay switches
// keeping the cues and reusing the one track.

import { describe, it, expect, beforeEach } from 'vitest';
import { createCaptionTrack } from '../src/content/caption-track.js';
import { createCaptionRenderer, applyMediaEvent } from '../src/content/caption-renderer.js';

function fakeTrack(kind, label, language) {
  const list = [];
  return {
    kind,
    label,
    language,
    mode: 'disabled',
    list,
    active: [],
    get cues() {
      return this.mode === 'disabled' ? null : list.slice();
    },
    get activeCues() {
      return this.active.slice();
    },
    addCue(c) {
      list.push(c);
    },
    removeCue(c) {
      const i = list.indexOf(c);
      if (i < 0) throw new Error('NotFoundError');
      list.splice(i, 1);
    },
  };
}

let video;
let added;
const addTextTrack = (v, kind, label, language) => {
  const t = fakeTrack(kind, label, language);
  v.textTracks.push(t);
  added++;
  return t;
};
const createCue = (startTime, endTime, text) => ({ startTime, endTime, text, id: '' });
const shown = (track) => track.list.map((c) => `${c.id}@${c.startTime}-${c.endTime}:${c.text}`);
const overlayText = (r) => [...r.view.host.shadowRoot.querySelectorAll('.tc-cap-line')].map((l) => l.textContent);

const CUES = [
  { id: 'a', start: 1, end: 3, text: 'Hello' },
  { id: 'b', start: 3, end: 6, text: 'Fish & <chips>' },
  { id: 'c', start: 6, end: 9, text: 'Bye' },
];

beforeEach(() => {
  document.body.replaceChildren();
  const wrap = document.createElement('div');
  video = document.createElement('video');
  wrap.append(video);
  document.body.append(wrap);
  Object.defineProperty(video, 'textTracks', { value: [], configurable: true });
  Object.defineProperty(video, 'currentTime', { value: 0, writable: true, configurable: true });
  added = 0;
});

describe('createCaptionTrack', () => {
  it('adds one showing subtitles track; set / upsert / updateText / clear', () => {
    const t = createCaptionTrack({ video, lang: 'zh', addTextTrack, createCue });
    expect(t.track).toMatchObject({ kind: 'subtitles', label: 'T-Caption', language: 'zh', mode: 'showing' });
    t.set(CUES);
    expect(shown(t.track)).toEqual(['a@1-3:Hello', 'b@3-6:Fish &amp; &lt;chips&gt;', 'c@6-10:Bye']); // each ends at the next, the last a beat after its end
    t.set(CUES.slice(0, 1));
    expect(shown(t.track)).toEqual(['a@1-4:Hello']);
    const cueA = t.track.list[0];
    t.upsert({ id: 'a', start: 1, end: 3, text: 'Hi' });
    expect(t.track.list[0]).toBe(cueA); // same times: the cue is edited in place
    t.upsert({ id: 'a', start: 1.5, end: 3, text: 'Hi' });
    t.upsert({ id: 'd', start: 4, end: 4, text: 'zero' });
    t.upsert({ id: 'e', start: 8, end: 7, text: 'reversed' });
    expect(shown(t.track)).toEqual(['a@1.5-4:Hi', 'd@4-5.5:zero', 'e@8-9.5:reversed']);
    t.updateText('d', 'one\ntwo');
    t.updateText('missing', 'ignored');
    expect(t.track.list[1].text).toBe('one\ntwo');
    t.clear();
    expect(t.track.list).toEqual([]);
    t.destroy();
    expect(t.track.mode).toBe('disabled');
  });

  it('never draws two cues at once: an earlier one ends where a later one starts; a hidden track keeps its cues', () => {
    const t = createCaptionTrack({ video, addTextTrack, createCue });
    t.set([{ id: 'a', start: 0, end: 5, text: 'long' }]);
    t.upsert({ id: 'b', start: 3, end: 6, text: 'overlapping' });
    t.upsert({ id: 'c', start: 3, end: 4, text: 'same start, given later' });
    expect(shown(t.track)).toEqual(['a@0-3:long', 'c@3-5:same start, given later']); // b would last no time: not drawn
    t.setHidden(true);
    expect(t.track.mode).toBe('hidden');
    expect(t.track.list).toHaveLength(2);
    t.setHidden(false);
    expect(t.track.mode).toBe('showing');
  });

  it('swaps a cue that is on screen for a fresh one when its text changes', () => {
    const t = createCaptionTrack({ video, addTextTrack, createCue });
    t.set(CUES);
    const cueA = t.track.list[0];
    t.track.active = [cueA];
    t.updateText('a', 'Hello\n你好');
    expect(t.track.list.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    const fresh = t.track.list[2];
    expect(fresh).not.toBe(cueA);
    expect(fresh).toMatchObject({ id: 'a', startTime: 1, endTime: 3, text: 'Hello\n你好' });
    t.track.active = [];
    t.updateText('a', 'Hello\n您好');
    expect(t.track.list[2]).toBe(fresh); // off screen: edited in place
    expect(fresh.text).toBe('Hello\n您好');
  });

  it('reuses its own track left on the video, emptied', () => {
    const first = createCaptionTrack({ video, addTextTrack, createCue });
    first.set(CUES);
    first.track.mode = 'disabled'; // as an earlier run would have left it, cues and all
    const again = createCaptionTrack({ video, addTextTrack, createCue });
    expect(added).toBe(1);
    expect(again.track).toBe(first.track);
    expect(again.track.mode).toBe('showing');
    expect(again.track.list).toEqual([]);
  });
});

describe('createCaptionRenderer', () => {
  const make = (opts) => createCaptionRenderer({ video, addTextTrack, createCue, ...opts });

  it('bilingual: the original, then original + translation once it arrives', () => {
    const r = make();
    r.setCues(CUES);
    const track = video.textTracks[0];
    expect(shown(track)[0]).toBe('a@1-3:Hello');
    r.setTranslation('a', 'pending', false);
    expect(track.list[0].text).toBe('Hello');
    r.setTranslation('a', '你', false);
    expect(track.list[0].text).toBe('Hello\n你');
    r.setTranslation('a', '你好\n世界', true);
    expect(track.list[0].text).toBe('Hello\n你好世界');
    r.setTranslation('nope', 'x', true);
    expect(r.list().map((e) => e.translation)).toEqual(['你好世界', null, null]);
  });

  it('translation shows only the translation, falling back to the original; original ignores it', () => {
    const r = make({ display: 'translation' });
    r.setCues(CUES);
    r.setTranslation('b', '炸鱼薯条', true);
    const track = video.textTracks[0];
    expect(track.list.map((c) => c.text)).toEqual(['Hello', '炸鱼薯条', 'Bye']);
    r.setDisplay('original');
    expect(track.list.map((c) => c.text)).toEqual(['Hello', 'Fish &amp; &lt;chips&gt;', 'Bye']);
    r.setDisplay('bilingual');
    expect(track.list[1].text).toBe('Fish &amp; &lt;chips&gt;\n炸鱼薯条');
    r.setDisplay('bogus');
    expect(r.display).toBe('bilingual');
  });

  it('a failed translation (done, no text) falls back to the original', () => {
    const r = make();
    r.setCues(CUES);
    r.setTranslation('c', '再', false);
    r.setTranslation('c', null, true);
    expect(video.textTracks[0].list[2].text).toBe('Bye');
  });

  it('setCues keeps a translation while the cue text is unchanged', () => {
    const r = make();
    r.setCues(CUES);
    r.setTranslation('a', '你好', true);
    r.setTranslation('c', '再见', true);
    r.setCues([CUES[0], { ...CUES[2], text: 'Bye now' }, { id: 'x', start: 1, end: 2, text: '  ' }]);
    expect(r.list().map((e) => [e.id, e.translation])).toEqual([['a', '你好'], ['c', null]]);
  });

  it('applyMediaEvent: segment, then its translation stream; other events ignored', () => {
    const r = make();
    expect(applyMediaEvent(r, { type: 'segment', id: 7, start: 100.14, end: 102.5, text: 'Hello world', lang: 'en' })).toBe(true);
    applyMediaEvent(r, { type: 'translation', id: 7, text: 'pending', done: false });
    const track = video.textTracks[0];
    expect(shown(track)).toEqual(['7@100.14-103.5:Hello world']);
    applyMediaEvent(r, { type: 'translation', id: 7, text: '你好', done: false });
    applyMediaEvent(r, { type: 'translation', id: 7, text: '你好，世界', done: true });
    expect(track.list[0].text).toBe('Hello world\n你好，世界');
    expect(applyMediaEvent(r, { type: 'status', state: 'listening' })).toBe(false);
    expect(applyMediaEvent(r, { type: 'closed', reason: 'closed' })).toBe(false);
    expect(applyMediaEvent(r, null)).toBe(false);
  });

  it('switches track ⇄ overlay keeping cues and translations, one track only', () => {
    const r = make();
    r.setCues(CUES);
    r.setTranslation('b', '炸鱼薯条', true);
    const track = video.textTracks[0];
    r.setMode('overlay');
    expect(r.mode).toBe('overlay');
    expect(track.mode).toBe('disabled');
    expect(track.list).toEqual([]);
    video.currentTime = 4;
    r.view.refresh();
    expect(overlayText(r)).toEqual(['Fish & <chips>', '炸鱼薯条']);
    r.setDisplay('translation');
    expect(overlayText(r)).toEqual(['炸鱼薯条']);
    r.setMode('track');
    expect(added).toBe(1);
    expect(document.querySelector('.tc-cap-host')).toBeNull();
    expect(shown(track)).toEqual(['a@1-3:Hello', 'b@3-6:炸鱼薯条', 'c@6-10:Bye']);
    r.destroy();
    expect(track.mode).toBe('disabled');
    expect(r.list()).toEqual([]);
  });

  it('the size reaches the track through one page stylesheet and the overlay through its factor', () => {
    const r = make();
    expect(r.size).toBe('medium');
    expect(video.getAttribute('data-tc-cap-size')).toBe('medium');
    const sheet = document.getElementById('tc-cap-cue-size');
    expect(sheet.textContent).toContain('video[data-tc-cap-size="medium"]::cue { font-size: 80%; }');
    r.setSize('large');
    r.setSize('bogus');
    expect(video.getAttribute('data-tc-cap-size')).toBe('large');
    r.setMode('overlay');
    expect(r.view.host.shadowRoot.querySelector('.tc-cap-root').style.getPropertyValue('--tc-cap-scale')).toBe('1');
    r.setSize('small');
    expect(r.view.host.shadowRoot.querySelector('.tc-cap-root').style.getPropertyValue('--tc-cap-scale')).toBe('0.65');
    r.setMode('track');
    expect(video.getAttribute('data-tc-cap-size')).toBe('small');
    r.destroy();
    expect(video.hasAttribute('data-tc-cap-size')).toBe(false);
    expect(document.querySelectorAll('#tc-cap-cue-size')).toHaveLength(1);
  });
});
