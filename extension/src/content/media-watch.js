// Isolated world: the page's <video> / <audio> elements. Found by a
// MutationObserver and by media events caught in the capture phase on the
// document (they do not bubble); each event reports the element's snapshot,
// timeupdate at most once per timeupdateMs. Element ids live in a WeakMap,
// nothing is written into the page.

const EVENTS = ['play', 'pause', 'seeking', 'seeked', 'ended', 'loadedmetadata', 'durationchange', 'emptied', 'volumechange', 'timeupdate'];
const OWN_TRACK = 'T-Caption';

const isMedia = (n) => !!n && (n.nodeName === 'VIDEO' || n.nodeName === 'AUDIO');
const round3 = (x) => Math.round(x * 1000) / 1000;

function stateOf(el) {
  if (el.ended) return 'ended';
  if (el.seeking) return 'seeking';
  if (!el.paused) return 'playing';
  return el.readyState === 0 ? 'idle' : 'paused';
}

// End of the buffered range holding the playhead, or null.
function bufferedEnd(el) {
  const b = el.buffered;
  const t = el.currentTime;
  if (!b) return null;
  for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.25 && t <= b.end(i)) return round3(b.end(i));
  return null;
}

export function createMediaWatch({ doc, win, onReport = () => {}, onRemoved = () => {}, msIdOf = () => null, now = () => Date.now(), timeupdateMs = 1000 }) {
  const ids = new WeakMap();
  const known = new Map(); // elId → element
  const ticked = new WeakMap();
  let next = 0;
  let observer = null;

  function snapshot(el) {
    const r = el.getBoundingClientRect();
    const inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < win.innerHeight && r.left < win.innerWidth;
    const shown = typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : true;
    const src = String(el.currentSrc || el.src || '').slice(0, 2048);
    const d = el.duration;
    return {
      elId: ids.get(el),
      tag: el.nodeName.toLowerCase(),
      src,
      msId: src.startsWith('blob:') ? msIdOf(src) : null,
      state: stateOf(el),
      currentTime: round3(el.currentTime || 0),
      duration: Number.isFinite(d) ? round3(d) : null,
      live: d === Infinity,
      muted: !!el.muted,
      volume: round3(el.volume ?? 1),
      readyState: el.readyState | 0,
      width: Math.round(r.width),
      height: Math.round(r.height),
      videoWidth: el.videoWidth | 0,
      videoHeight: el.videoHeight | 0,
      visible: inView && shown,
      pageVisible: doc.visibilityState === 'visible',
      bufferedEndS: bufferedEnd(el),
      encrypted: !!el.mediaKeys,
      siteTracks: Array.from(el.textTracks || []).filter((t) => t.label !== OWN_TRACK).length,
    };
  }

  function track(el) {
    if (ids.has(el)) return false;
    const id = ++next;
    ids.set(el, id);
    known.set(id, el);
    return true;
  }

  function found(node) {
    const els = isMedia(node) ? [node] : node.getElementsByTagName ? [...node.getElementsByTagName('video'), ...node.getElementsByTagName('audio')] : [];
    for (const el of els) if (track(el)) onReport(snapshot(el), 'added');
  }

  function sweep() {
    for (const [id, el] of known) {
      if (!el.isConnected) {
        known.delete(id);
        onRemoved(id);
      }
    }
  }

  function onEvent(e) {
    const el = e.target;
    if (!isMedia(el)) return;
    if (e.type === 'timeupdate') {
      const t = now();
      if (t - (ticked.get(el) ?? -Infinity) < timeupdateMs) return;
      ticked.set(el, t);
    }
    track(el);
    onReport(snapshot(el), e.type);
  }

  const area = (el) => {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  };

  return {
    start() {
      for (const type of EVENTS) doc.addEventListener(type, onEvent, true);
      observer = new MutationObserver((records) => {
        let removed = false;
        for (const r of records) {
          for (const n of r.addedNodes) if (n.nodeType === 1) found(n);
          if (r.removedNodes.length) removed = true;
        }
        if (removed) sweep();
      });
      observer.observe(doc, { childList: true, subtree: true });
      this.scan();
    },
    scan() {
      if (doc.documentElement) found(doc.documentElement);
    },
    stop() {
      for (const type of EVENTS) doc.removeEventListener(type, onEvent, true);
      observer?.disconnect();
    },
    // The playing <video> with the largest box, else the largest one.
    primaryVideo() {
      const videos = [...known.values()].filter((el) => el.isConnected && el.nodeName === 'VIDEO');
      const playing = videos.filter((el) => !el.paused && !el.ended);
      const pool = playing.length ? playing : videos;
      return pool.sort((a, b) => area(b) - area(a))[0] || null;
    },
    idOf: (el) => ids.get(el) ?? null,
    snapshot: (el) => snapshot(el),
    list: () => [...known.values()].filter((el) => el.isConnected).map(snapshot),
  };
}
