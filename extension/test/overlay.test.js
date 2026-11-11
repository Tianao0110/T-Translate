// The caption overlay in jsdom: how long a cue holds, picking the newest cues
// on screen (binary search plus the running max hold), text following
// currentTime and edits, cue boxes kept while shown, the size factor, the
// host moving into the fullscreen element and back, and destroy leaving
// nothing behind.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOverlay, shownIndexes, holdUntil, MAX_SHOWN } from '../src/content/overlay.js';

const prep = (list) => {
  const cues = [...list].sort((a, b) => a.start - b.start);
  let max = -Infinity;
  return [cues, cues.map((c) => (max = Math.max(max, c.hold)))];
};

describe('holdUntil', () => {
  it('a beat past the end, or longer when the text needs reading time', () => {
    expect(holdUntil({ start: 0, end: 3, text: 'ok' })).toBe(4);
    const long = 'x'.repeat(100);
    expect(holdUntil({ start: 0, end: 1, text: long })).toBeCloseTo(5.6, 5);
    expect(holdUntil({ start: 0, end: 1, text: '字'.repeat(50) })).toBeCloseTo(5.6, 5); // CJK counts double
  });
});

describe('shownIndexes', () => {
  const [cues, maxHold] = prep([
    { start: 0, hold: 100 }, // a long one that stays under everything
    { start: 10, hold: 12 },
    { start: 11, hold: 15 },
    { start: 20, hold: 21 },
    { start: 120, hold: 125 },
    { start: 130, hold: 131 },
  ]);
  const at = (t) => shownIndexes(cues, maxHold, t);

  it('the newest cue still held at t; more, oldest first, when asked for', () => {
    expect(MAX_SHOWN).toBe(1);
    expect(at(5)).toEqual([0]);
    expect(at(10)).toEqual([1]); // start is inclusive
    expect(at(11.5)).toEqual([2]);
    expect(at(12)).toEqual([2]);
    expect(at(16)).toEqual([0]); // hold is exclusive
    expect(shownIndexes(cues, maxHold, 12, 2)).toEqual([0, 2]);
    expect(shownIndexes(cues, maxHold, 11.5, 3)).toEqual([0, 1, 2]);
  });

  it('nothing before, between and after', () => {
    expect(at(-1)).toEqual([]);
    expect(at(126)).toEqual([]);
    expect(at(131)).toEqual([]);
    expect(shownIndexes([], [], 3)).toEqual([]);
  });

  it('matches a linear scan on random cues', () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const list = Array.from({ length: 300 }, () => {
      const start = rnd() * 600;
      return { start, hold: start + rnd() * (rnd() < 0.05 ? 120 : 6) };
    });
    const [sorted, holds] = prep(list);
    for (let k = 0; k < 500; k++) {
      const t = rnd() * 700;
      const want = [];
      sorted.forEach((c, i) => {
        if (c.start <= t && c.hold > t) want.push(i);
      });
      expect(shownIndexes(sorted, holds, t)).toEqual(want.slice(-MAX_SHOWN));
    }
  });
});

describe('createOverlay', () => {
  let stage;
  let wrap;
  let video;
  let fsEl = null;

  beforeEach(() => {
    document.body.replaceChildren();
    stage = document.createElement('div');
    wrap = document.createElement('div');
    video = document.createElement('video');
    wrap.append(video);
    stage.append(wrap);
    document.body.append(stage);
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true, configurable: true });
    fsEl = null;
    Object.defineProperty(document, 'fullscreenElement', { get: () => fsEl, configurable: true });
  });
  afterEach(() => {
    delete document.fullscreenElement;
  });

  const lines = (o) => [...o.host.shadowRoot.querySelectorAll('.tc-cap-line')].map((l) => l.textContent);
  const boxHidden = (o) => o.host.shadowRoot.querySelector('.tc-cap-box').hidden;

  it('mounts next to the video, isolated, click-through', () => {
    const o = createOverlay({ video });
    expect(o.host.parentElement).toBe(wrap);
    expect(o.host.style.getPropertyValue('pointer-events')).toBe('none');
    const css = o.host.shadowRoot.querySelector('style').textContent;
    expect(css).toMatch(/\.tc-cap-line/);
    for (const v of ['--tc-cap-fg', '--tc-cap-bg', '--tc-cap-size']) expect(css).toContain(v);
    expect(boxHidden(o)).toBe(true);
  });

  it('shows the cue active at currentTime, following time updates and edits', () => {
    const o = createOverlay({ video });
    o.set([
      { id: 'b', start: 3, end: 6, text: 'second\n第二' },
      { id: 'a', start: 1, end: 3, text: 'first' },
      { id: 'z', start: 8, end: 8, text: 'zero length' },
    ]);
    expect(lines(o)).toEqual([]);
    video.currentTime = 1;
    video.dispatchEvent(new Event('timeupdate'));
    expect(lines(o)).toEqual(['first']);
    video.currentTime = 4;
    video.dispatchEvent(new Event('seeked'));
    expect(lines(o)).toEqual(['second', '第二']);
    o.updateText('b', 'second\n第二个');
    expect(lines(o)).toEqual(['second', '第二个']);
    video.currentTime = 8.2;
    o.refresh();
    expect(lines(o)).toEqual(['zero length']); // stretched to half a second
    o.upsert({ id: 'y', start: 8.1, end: 9, text: 'newer' });
    expect(lines(o)).toEqual(['newer']);
    o.clear();
    expect(lines(o)).toEqual([]);
    expect(boxHidden(o)).toBe(true);
  });

  it('a cue lingers through a short gap, keeps its box while its text changes, and gives way to the next', () => {
    const o = createOverlay({ video });
    o.set([
      { id: 'a', start: 0, end: 2, text: 'one' },
      { id: 'b', start: 4, end: 6, text: 'two' },
      { id: 'c', start: 6, end: 8, text: 'three' },
    ]);
    const at = (t) => {
      video.currentTime = t;
      o.refresh();
      return lines(o);
    };
    expect(at(2.5)).toEqual(['one']); // a beat past its end
    expect(at(3.1)).toEqual([]);
    expect(at(4)).toEqual(['two']);
    const box = o.host.shadowRoot.querySelector('.tc-cap-cue');
    o.updateText('b', 'two\n二');
    expect(lines(o)).toEqual(['two', '二']);
    expect(o.host.shadowRoot.querySelector('.tc-cap-cue')).toBe(box);
    expect(at(6)).toEqual(['three']);
    expect(o.host.shadowRoot.querySelectorAll('.tc-cap-cue')).toHaveLength(1);
  });

  it('scales the text by the size factor', () => {
    const scale = (o) => o.host.shadowRoot.querySelector('.tc-cap-root').style.getPropertyValue('--tc-cap-scale');
    const o = createOverlay({ video });
    expect(scale(o)).toBe('0.8');
    o.setSize('xlarge');
    expect(scale(o)).toBe('1.25');
    o.setSize('nonsense');
    expect(scale(o)).toBe('0.8');
    expect(scale(createOverlay({ video, size: 'small' }))).toBe('0.65');
  });

  it('moves into the fullscreen element and back', () => {
    const o = createOverlay({ video });
    fsEl = stage;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(o.host.parentElement).toBe(stage);
    fsEl = video; // the bare video fullscreen: nothing can draw over it
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(o.host.parentElement).toBe(wrap);
    fsEl = document.createElement('div'); // something else fullscreen
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(o.host.parentElement).toBe(wrap);
    fsEl = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(o.host.parentElement).toBe(wrap);
  });

  it('uses requestVideoFrameCallback when there is one; destroy leaves nothing', () => {
    let next = 0;
    const pending = new Map();
    video.requestVideoFrameCallback = vi.fn((cb) => {
      pending.set(++next, cb);
      return next;
    });
    video.cancelVideoFrameCallback = vi.fn((h) => pending.delete(h));
    const o = createOverlay({ video });
    o.set([{ id: 'a', start: 0, end: 5, text: 'frame' }]);
    expect(pending.size).toBe(1);
    video.currentTime = 1;
    const [h, cb] = [...pending][0];
    pending.delete(h);
    cb(0, { mediaTime: 1 });
    expect(lines(o)).toEqual(['frame']);
    expect(pending.size).toBe(1); // re-armed

    o.destroy();
    expect(video.cancelVideoFrameCallback).toHaveBeenLastCalledWith(next);
    expect(pending.size).toBe(0);
    expect(document.querySelector('.tc-cap-host')).toBeNull();
    fsEl = stage;
    document.dispatchEvent(new Event('fullscreenchange'));
    video.dispatchEvent(new Event('timeupdate'));
    expect(stage.querySelector('.tc-cap-host')).toBeNull();
    o.upsert({ id: 'late', start: 0, end: 5, text: 'after destroy' });
    expect(document.querySelector('.tc-cap-host')).toBeNull();
  });
});
