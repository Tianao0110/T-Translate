// The top edge (viewport y) of a player's own bars drawn over the lower half
// of the video, for the caption overlay to sit above; null when none shows.
// Each site adapter's controlsTop picks the elements.

const MIN_OPACITY = 0.05;

// Drawn as seen: laid out, not hidden, opacity (its own times its ancestors'
// up to `stop`) above MIN_OPACITY.
function onScreen(el, stop) {
  const win = el.ownerDocument.defaultView;
  let opacity = 1;
  for (let e = el; e; e = e.parentElement) {
    const cs = win.getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    opacity *= cs.opacity === '' ? 1 : Number(cs.opacity);
    if (!(opacity >= MIN_OPACITY)) return false;
    if (e === stop) break;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function topOf(video, elements, stop) {
  const v = video.getBoundingClientRect();
  let top = null;
  for (const el of elements) {
    if (!el || !onScreen(el, stop)) continue;
    const r = el.getBoundingClientRect();
    if (r.top < v.top + v.height / 2 || r.top >= v.bottom || r.right <= v.left || r.left >= v.right) continue;
    top = top === null ? r.top : Math.min(top, r.top);
  }
  return top;
}
