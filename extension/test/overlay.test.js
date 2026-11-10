// The caption overlay in jsdom: active-cue picking (binary search plus the
// running max end), text following currentTime and edits, the host moving
// into the fullscreen element and back, and destroy leaving nothing behind.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOverlay, activeIndex } from '../src/content/overlay.js';

const prep = (list) => {
  const cues = [...list].sort((a, b) => a.start - b.start);
  let max = -Infinity;
  return [cues, cues.map((c) => (max = Math.max(max, c.end)))];
};

describe('activeIndex', () => {
  const [cues, maxEnd] = prep([
    { start: 0, end: 100 }, // a long one that stays under everything
    { start: 10, end: 12 },
    { start: 11, end: 15 },
    { start: 20, end: 21 },
    { start: 120, end: 125 },
    { start: 130, end: 131 },
  ]);
  const at = (t) => activeIndex(cues, maxEnd, t);

  it('picks the latest-starting cue that covers t', () => {
    expect(at(5)).toBe(0);
    expect(at(10)).toBe(1); // start is inclusive
    expect(at(11.5)).toBe(2);
    expect(at(12)).toBe(2);
    expect(at(16)).toBe(0); // back to the long cue
    expect(at(20.5)).toBe(3);
  });

  it('-1 before, between and after', () => {
    expect(at(-1)).toBe(-1);
    expect(at(100)).toBe(-1); // end is exclusive
    expect(at(126)).toBe(-1);
    expect(at(131)).toBe(-1);
    expect(activeIndex([], [], 3)).toBe(-1);
  });

  it('matches a linear scan on random cues', () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const list = Array.from({ length: 300 }, () => {
      const start = rnd() * 600;
      return { start, end: start + rnd() * (rnd() < 0.05 ? 120 : 6) };
    });
    const [sorted, ends] = prep(list);
    for (let k = 0; k < 500; k++) {
      const t = rnd() * 700;
      let want = -1;
      sorted.forEach((c, i) => {
        if (c.start <= t && c.end > t) want = i;
      });
      expect(activeIndex(sorted, ends, t)).toBe(want);
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
