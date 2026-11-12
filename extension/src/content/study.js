// Sentence controls over the captions on a video: jump to the previous or
// next sentence or back to the start of this one, and pause at the end of
// every sentence. cues() hands the shown cues ({ start, end }, any offset
// applied); control ({ seek(s), pause(), play() }) stands in for the video's
// own when the site's player must do them. The page agent drives it from
// commands and the shortcut keys.

const EDGE_S = 0.05;
const MAX_STEP_S = 1.5; // a bigger jump between two readings is a seek

// The cue to go to from time t: 'repeat' the one playing (or the first),
// 'prev' the one before it, 'next' the one after it; null when there is none.
export function sentenceTarget(cues, t, action) {
  const list = [...cues].sort((a, b) => a.start - b.start);
  if (!list.length) return null;
  let i = -1;
  for (let k = 0; k < list.length && list[k].start <= t + EDGE_S; k++) i = k;
  if (action === 'repeat') return list[Math.max(i, 0)];
  if (action === 'prev') return list[Math.max(i - 1, 0)];
  if (action === 'next') return list[i + 1] ?? null;
  return null;
}

// A cue whose end the playhead passed between two readings while playing.
export function crossedEnd(cues, from, to) {
  if (!(to > from) || to - from > MAX_STEP_S) return null;
  for (const c of cues) if (c.end > from && c.end <= to && c.start < c.end) return c;
  return null;
}

export function createStudy({ video, cues, control = null }) {
  const seek = control?.seek ?? ((s) => (video.currentTime = s));
  const pause = control?.pause ?? (() => video.pause());
  const play = control?.play ?? (() => Promise.resolve(video.play?.()).catch(() => {}));
  let autoPause = false;
  let last = video.currentTime;
  let frame = 0;
  const hasVfc = typeof video.requestVideoFrameCallback === 'function';

  function check() {
    const t = video.currentTime;
    if (autoPause && !video.paused && crossedEnd(cues(), last, t)) pause();
    last = t;
  }
  const onFrame = () => {
    frame = autoPause ? video.requestVideoFrameCallback(onFrame) : 0;
    check();
  };
  const arm = () => {
    if (autoPause && hasVfc && !frame) frame = video.requestVideoFrameCallback(onFrame);
  };
  const onSeeked = () => {
    last = video.currentTime;
  };
  const onTime = () => (hasVfc ? null : check());

  video.addEventListener('seeked', onSeeked);
  video.addEventListener('play', arm);
  video.addEventListener('timeupdate', onTime);

  return {
    get autoPause() {
      return autoPause;
    },
    setAutoPause(on) {
      autoPause = !!on;
      last = video.currentTime;
      if (autoPause) arm();
      else if (frame) {
        video.cancelVideoFrameCallback?.(frame);
        frame = 0;
      }
    },
    // Goes to that sentence and plays from its start; the cue, or null.
    go(action) {
      const target = sentenceTarget(cues(), video.currentTime, action);
      if (!target) return null;
      last = Math.max(0, target.start);
      seek(last);
      if (video.paused) play();
      return target;
    },
    destroy() {
      if (frame) video.cancelVideoFrameCallback?.(frame);
      frame = 0;
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('play', arm);
      video.removeEventListener('timeupdate', onTime);
    },
  };
}
