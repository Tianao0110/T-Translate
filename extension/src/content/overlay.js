// Captions drawn over the video, for pages that hide native tracks: a box in
// a shadow root (site CSS stays out), mounted in the fullscreen element while
// one holds the video. One cue at a time: it stays past its end, until it has
// had time to be read or the next one starts, and a new one fades in. Same
// set / upsert / updateText / clear / setSize / destroy as
// caption-track.js. The text size follows the video's height, or its width
// when that is the shorter measure (portrait video), times the size factor.
// controlsTop(video) (the site adapter's) says where the player's own bars
// start while they show; the box rises above them and comes back down.

import { cueTimes } from './caption-track.js';
import { DEFAULT_SIZE, scaleOf } from './caption-size.js';

export const MAX_SHOWN = 1;
const LINGER_S = 1;
const READ_BASE_S = 0.6;
const READ_WIDTH_PER_S = 20; // a CJK character counts 2
const CONTROLS_GAP_PX = 8;
const MAX_LIFT = 0.5; // of the video's height
const CONTROLS_POLL_MS = 250;

const WIDE = /[\u{1100}-\u{11FF}\u{2E80}-\u{9FFF}\u{AC00}-\u{D7AF}\u{F900}-\u{FAFF}\u{FF00}-\u{FFEF}]/u;

const HOST_STYLE = {
  all: 'initial',
  display: 'block',
  position: 'absolute',
  left: '0px',
  top: '0px',
  width: '0px',
  height: '0px',
  'pointer-events': 'none',
  'z-index': '2147483000',
};

const CSS = `
.tc-cap-root { position: absolute; inset: 0; overflow: hidden; container-type: size; }
.tc-cap-box {
  position: absolute; left: 4%; right: 4%; bottom: max(7%, var(--tc-cap-lift, 0px));
  transition: bottom 150ms ease-out;
  display: flex; flex-direction: column; align-items: center; gap: 0.35em;
  font-family: system-ui, "Segoe UI", "PingFang SC", "Hiragino Sans", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: var(--tc-cap-size, clamp(12px, calc(min(4.6cqh, 4.5cqw) * var(--tc-cap-scale, 1)), 64px));
  font-weight: 500; line-height: 1.35; text-align: center;
}
.tc-cap-box[hidden] { display: none; }
.tc-cap-cue {
  display: flex; flex-direction: column; align-items: center; gap: 0.12em; max-width: 100%;
  animation: tc-cap-in 160ms ease-out;
}
@keyframes tc-cap-in { from { opacity: 0; transform: translateY(0.3em); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .tc-cap-box { transition: none; } .tc-cap-cue { animation: none; } }
.tc-cap-line {
  max-width: 100%; box-sizing: border-box; padding: 0.04em 0.4em; border-radius: 0.18em;
  color: var(--tc-cap-fg, #fff); background: var(--tc-cap-bg, rgba(8, 8, 8, 0.55));
  text-shadow: 0 0 0.08em #000, 0.04em 0.04em 0.08em #000, -0.04em -0.04em 0.08em #000,
    0.04em -0.04em 0.08em #000, -0.04em 0.04em 0.08em #000;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
`;

// When a cue may leave the screen: a beat after its end, or once its text has
// had time to be read, whichever is later.
export function holdUntil({ start, end, text }) {
  let w = 0;
  for (const ch of String(text).replace(/\s+/g, ' ').trim()) w += WIDE.test(ch) ? 2 : 1;
  return Math.max(end + LINGER_S, start + READ_BASE_S + w / READ_WIDTH_PER_S);
}

// Indexes of the newest `max` cues with start <= t < hold, oldest first. cues
// are sorted by start and maxHold[i] is the largest hold among cues[0..i], so
// the walk back stops as soon as nothing earlier can still be on screen.
export function shownIndexes(cues, maxHold, t, max = MAX_SHOWN) {
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  const out = [];
  for (let i = lo - 1; i >= 0 && out.length < max && maxHold[i] > t; i--) if (cues[i].hold > t) out.push(i);
  return out.reverse();
}

export function createOverlay({ video, size = DEFAULT_SIZE, controlsTop = null }) {
  const doc = video.ownerDocument;
  const win = doc.defaultView;
  const host = doc.createElement('div');
  host.className = 'tc-cap-host';
  for (const [k, v] of Object.entries(HOST_STYLE)) host.style.setProperty(k, v, 'important');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const root = doc.createElement('div');
  root.className = 'tc-cap-root';
  const box = doc.createElement('div');
  box.className = 'tc-cap-box';
  box.hidden = true;
  root.append(box);
  shadow.append(style, root);

  const byId = new Map();
  const shownEls = new Map(); // id -> { el, text }
  let sorted = null;
  let maxHold = [];
  let holdsStale = false;
  let lastBox = '';
  let lastLift = 0;
  let destroyed = false;

  const setSize = (next) => root.style.setProperty('--tc-cap-scale', String(scaleOf(next)));
  setSize(size);

  function mount() {
    const fs = doc.fullscreenElement;
    const target = fs && fs !== video && fs.contains(video) ? fs : video.parentElement;
    if (target && host.parentNode !== target) target.append(host);
  }

  // Lays the host over the video box, relative to the host's containing block.
  function place() {
    const v = video.getBoundingClientRect();
    const parent = host.offsetParent;
    let x = v.left;
    let y = v.top;
    if (parent && !(parent === doc.body && win.getComputedStyle(parent).position === 'static')) {
      const p = parent.getBoundingClientRect();
      x += parent.scrollLeft - p.left - parent.clientLeft;
      y += parent.scrollTop - p.top - parent.clientTop;
    } else {
      x += win.scrollX;
      y += win.scrollY;
    }
    const next = [x, y, v.width, v.height].map((n) => `${Math.round(n)}px`);
    if (next.join() === lastBox) return;
    lastBox = next.join();
    ['left', 'top', 'width', 'height'].forEach((k, i) => host.style.setProperty(k, next[i], 'important'));
  }

  function lift() {
    if (!controlsTop) return;
    let top = null;
    try {
      top = controlsTop(video);
    } catch {} // a player mid-rebuild
    const v = video.getBoundingClientRect();
    const px = Number.isFinite(top) ? Math.round(Math.min(v.height * MAX_LIFT, Math.max(0, v.bottom - top + CONTROLS_GAP_PX))) : 0;
    if (px === lastLift) return;
    lastLift = px;
    root.style.setProperty('--tc-cap-lift', `${px}px`);
  }

  function linesOf(text) {
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const el = doc.createElement('div');
        el.className = 'tc-cap-line';
        el.textContent = line;
        return el;
      });
  }

  // Cue boxes stay in place while they are shown (a new one alone animates in);
  // only their lines change when a translation lands.
  function render(list) {
    const keep = new Set(list.map((c) => c.id));
    for (const [id, r] of shownEls) {
      if (keep.has(id)) continue;
      r.el.remove();
      shownEls.delete(id);
    }
    let next = null;
    for (let k = list.length - 1; k >= 0; k--) {
      const c = list[k];
      let r = shownEls.get(c.id);
      if (!r) {
        r = { el: doc.createElement('div'), text: null };
        r.el.className = 'tc-cap-cue';
        shownEls.set(c.id, r);
      }
      if (r.text !== c.text) {
        r.text = c.text;
        r.el.replaceChildren(...linesOf(c.text));
      }
      if (r.el.parentNode !== box || r.el.nextSibling !== next) box.insertBefore(r.el, next);
      next = r.el;
    }
    box.hidden = list.length === 0;
  }

  function refresh() {
    if (destroyed) return;
    if (!sorted) {
      sorted = [...byId.values()].sort((a, b) => a.start - b.start);
      holdsStale = true;
    }
    if (holdsStale) {
      let max = -Infinity;
      maxHold = sorted.map((c) => (max = Math.max(max, (c.hold = holdUntil(c)))));
      holdsStale = false;
    }
    mount();
    if (host.isConnected) {
      place();
      lift();
    }
    render(shownIndexes(sorted, maxHold, video.currentTime).map((i) => sorted[i]).filter((c) => c.text));
  }

  function put({ id, start, end, text }) {
    const [s, e] = cueTimes(Number(start), Number(end));
    byId.set(id, { id, start: s, end: e, text: String(text ?? ''), hold: e });
    sorted = null;
  }

  // requestVideoFrameCallback per presented frame, else rAF while playing;
  // the events cover seeks, pauses and size changes.
  let frame = 0;
  let raf = 0;
  const hasVfc = typeof video.requestVideoFrameCallback === 'function';
  const onFrame = () => {
    frame = video.requestVideoFrameCallback(onFrame);
    refresh();
  };
  const onRaf = () => {
    raf = win.requestAnimationFrame(onRaf);
    if (!video.paused) refresh();
  };
  if (hasVfc) frame = video.requestVideoFrameCallback(onFrame);
  else if (typeof win.requestAnimationFrame === 'function') raf = win.requestAnimationFrame(onRaf);

  const ac = new AbortController();
  const opts = { signal: ac.signal };
  const onChange = () => refresh();
  for (const type of ['seeked', 'timeupdate', 'play', 'pause', 'loadedmetadata', 'resize', 'emptied']) video.addEventListener(type, onChange, opts);
  doc.addEventListener('fullscreenchange', onChange, opts);
  win.addEventListener('resize', onChange, opts);
  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(onChange) : null;
  ro?.observe(video);
  // The player's bars come and go between frames and events.
  const poll = controlsTop ? win.setInterval(onChange, CONTROLS_POLL_MS) : 0;

  refresh();

  return {
    host,
    set(list) {
      byId.clear();
      for (const c of list) put(c);
      refresh();
    },
    upsert(cue) {
      put(cue);
      refresh();
    },
    updateText(id, text) {
      const c = byId.get(id);
      if (!c) return;
      c.text = String(text ?? '');
      holdsStale = true;
      refresh();
    },
    clear() {
      byId.clear();
      sorted = null;
      refresh();
    },
    setSize,
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ac.abort();
      ro?.disconnect();
      if (poll) win.clearInterval(poll);
      if (hasVfc && frame) video.cancelVideoFrameCallback?.(frame);
      if (raf) win.cancelAnimationFrame(raf);
      byId.clear();
      shownEls.clear();
      host.remove();
    },
  };
}
