// Pause at the end of every sentence of the captions on a video. cues()
// hands the shown cues ({ start, end }, any offset applied); control
// ({ pause() }) stands in for the video's own when the site's player must do
// it. The page agent drives it from the popup's setting.

const MAX_STEP_S = 1.5; // a bigger jump between two readings is a seek

// A cue whose end the playhead passed between two readings while playing.
export function crossedEnd(cues, from, to) {
  if (!(to > from) || to - from > MAX_STEP_S) return null;
  for (const c of cues) if (c.end > from && c.end <= to && c.start < c.end) return c;
  return null;
}

export function createStudy({ video, cues, control = null }) {
  const pause = control?.pause ?? (() => video.pause());
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
    destroy() {
      if (frame) video.cancelVideoFrameCallback?.(frame);
      frame = 0;
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('play', arm);
      video.removeEventListener('timeupdate', onTime);
    },
  };
}
