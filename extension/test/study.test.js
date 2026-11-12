// Pause per line: a cue end crossed while playing (a seek is not one),
// pausing at sentence ends through timeupdate or video frame callbacks, and a
// site's player pausing instead of the video.

import { describe, it, expect } from 'vitest';
import { crossedEnd, createStudy } from '../src/content/study.js';

const CUES = [
  { start: 6, end: 9 },
  { start: 1, end: 3 },
  { start: 3, end: 6 },
];

function fakeVideo({ frames = false } = {}) {
  const v = new EventTarget();
  Object.assign(v, {
    currentTime: 0,
    paused: true,
    plays: 0,
    play() {
      v.paused = false;
      v.plays++;
      v.dispatchEvent(new Event('play'));
      return Promise.resolve();
    },
    pause() {
      v.paused = true;
    },
  });
  if (frames) {
    v.pending = null;
    v.requestVideoFrameCallback = (fn) => {
      v.pending = fn;
      return 1;
    };
    v.cancelVideoFrameCallback = () => {
      v.pending = null;
    };
    // One presented frame at time t.
    v.frameAt = (t) => {
      v.currentTime = t;
      const fn = v.pending;
      v.pending = null;
      fn?.();
    };
  }
  v.tick = (t) => {
    v.currentTime = t;
    v.dispatchEvent(new Event('timeupdate'));
  };
  v.seek = (t) => {
    v.currentTime = t;
    v.dispatchEvent(new Event('seeked'));
  };
  return v;
}

describe('crossedEnd', () => {
  it('a cue end passed while playing; none for a seek or going back', () => {
    expect(crossedEnd(CUES, 2.9, 3.05)).toEqual({ start: 1, end: 3 });
    expect(crossedEnd(CUES, 3.05, 3.3)).toBeNull();
    expect(crossedEnd(CUES, 2, 5)).toBeNull();
    expect(crossedEnd(CUES, 5, 2)).toBeNull();
  });
});

describe('createStudy', () => {
  it('pauses at the end of each sentence through timeupdate, only while on', () => {
    const v = fakeVideo();
    const study = createStudy({ video: v, cues: () => CUES });
    v.play();
    v.tick(2.8);
    v.tick(3.1);
    expect(v.paused).toBe(false);
    study.setAutoPause(true);
    expect(study.autoPause).toBe(true);
    v.tick(5.8);
    v.tick(6.05);
    expect(v.paused).toBe(true);
    // After a seek it counts from the new place.
    v.play();
    v.seek(8.9);
    v.tick(9.1);
    expect(v.paused).toBe(true);
    v.play();
    v.seek(1.2);
    v.tick(1.4);
    expect(v.paused).toBe(false);
    study.setAutoPause(false);
    v.tick(2.9);
    v.tick(3.2);
    expect(v.paused).toBe(false);
  });

  it('with frame callbacks: watches every frame while on, stops asking when off', () => {
    const v = fakeVideo({ frames: true });
    const study = createStudy({ video: v, cues: () => CUES });
    study.setAutoPause(true);
    expect(v.pending).toBeTypeOf('function');
    v.play();
    v.frameAt(2.95);
    v.frameAt(3.02);
    expect(v.paused).toBe(true);
    study.setAutoPause(false);
    expect(v.pending).toBeNull();
    // timeupdate does nothing when frames drive it.
    study.setAutoPause(true);
    v.play();
    v.tick(5.9);
    v.tick(6.1);
    expect(v.paused).toBe(false);
    study.destroy();
    expect(v.pending).toBeNull();
  });

  it('a control pauses instead of the video; the shown cues come from cues()', () => {
    const v = fakeVideo();
    const calls = [];
    let shift = 0;
    const study = createStudy({ video: v, cues: () => CUES.map((c) => ({ start: c.start + shift, end: c.end + shift })), control: { pause: () => calls.push('pause') } });
    v.currentTime = 4;
    v.paused = false;
    study.setAutoPause(true);
    v.tick(5.9);
    v.tick(6.1);
    expect(v.paused).toBe(false);
    expect(calls).toEqual(['pause']);
    // Shifted cues: the end at 9 is now at 9.5.
    shift = 0.5;
    v.tick(9.1);
    v.tick(9.3);
    expect(calls).toEqual(['pause']);
    v.tick(9.6);
    expect(calls).toEqual(['pause', 'pause']);
    study.destroy();
  });
});
