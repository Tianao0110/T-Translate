// Captions drawn over the video, for pages that hide native tracks: a box in
// a shadow root (site CSS stays out), mounted in the fullscreen element while
// one holds the video, showing the latest cue active at currentTime. Same
// set / upsert / updateText / clear / destroy as caption-track.js.

import { cueTimes } from './caption-track.js';

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
  position: absolute; left: 4%; right: 4%; bottom: 7%;
  display: flex; flex-direction: column; align-items: center; gap: 0.12em;
  font-family: system-ui, "Segoe UI", "PingFang SC", "Hiragino Sans", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: var(--tc-cap-size, clamp(14px, 4.6cqh, 52px));
  font-weight: 500; line-height: 1.35; text-align: center;
}
.tc-cap-box[hidden] { display: none; }
.tc-cap-line {
  max-width: 100%; box-sizing: border-box; padding: 0.04em 0.4em; border-radius: 0.18em;
  color: var(--tc-cap-fg, #fff); background: var(--tc-cap-bg, rgba(8, 8, 8, 0.55));
  text-shadow: 0 0 0.08em #000, 0.04em 0.04em 0.08em #000, -0.04em -0.04em 0.08em #000,
    0.04em -0.04em 0.08em #000, -0.04em 0.04em 0.08em #000;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
`;

// Index of the latest-starting cue with start <= t < end, or -1. cues are
// sorted by start and maxEnd[i] is the largest end among cues[0..i], so the
// walk back stops as soon as nothing earlier can still be on screen.
export function activeIndex(cues, maxEnd, t) {
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0 && maxEnd[i] > t; i--) if (cues[i].end > t) return i;
  return -1;
}

export function createOverlay({ video }) {
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
  let sorted = null;
  let maxEnd = [];
  let shown = '';
  let lastBox = '';
  let destroyed = false;

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

  function render(text) {
    if (text === shown) return;
    shown = text;
    box.replaceChildren(
      ...text
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const el = doc.createElement('div');
          el.className = 'tc-cap-line';
          el.textContent = line;
          return el;
        })
    );
    box.hidden = !text;
  }

  function refresh() {
    if (destroyed) return;
    if (!sorted) {
      sorted = [...byId.values()].sort((a, b) => a.start - b.start);
      let max = -Infinity;
      maxEnd = sorted.map((c) => (max = Math.max(max, c.end)));
    }
    mount();
    if (host.isConnected) place();
    const i = activeIndex(sorted, maxEnd, video.currentTime);
    render(i < 0 ? '' : sorted[i].text);
  }

  function put({ id, start, end, text }) {
    const [s, e] = cueTimes(Number(start), Number(end));
    byId.set(id, { id, start: s, end: e, text: String(text ?? '') });
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
      refresh();
    },
    clear() {
      byId.clear();
      sorted = null;
      refresh();
    },
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ac.abort();
      ro?.disconnect();
      if (hasVfc && frame) video.cancelVideoFrameCallback?.(frame);
      if (raf) win.cancelAnimationFrame(raf);
      byId.clear();
      host.remove();
    },
  };
}
