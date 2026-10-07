// Zoom geometry for a pinned screenshot (PinWindow/index.jsx): which edge a
// point is on, and the zoom + window position an edge drag or a wheel step
// asks for. Pure; all values in DIP / CSS px.

// '' | 'n' 's' 'e' 'w' | 'ne' 'nw' 'se' 'sw' for a point inside a w×h window.
export function edgeAt(x, y, w, h, band) {
  const v = y < band ? 'n' : y > h - band ? 's' : '';
  const hz = x < band ? 'w' : x > w - band ? 'e' : '';
  return v + hz;
}

// Edge drag from `start` bounds by (dx, dy): aspect-locked zoom over the
// base size, the opposite side or corner fixed. Returns { zoom, place }
// where place(width, height) gives the window's top-left for the final size.
export function zoomFromEdge(side, start, dx, dy, base) {
  const zx = side.includes('e') ? (start.width + dx) / base.width
    : side.includes('w') ? (start.width - dx) / base.width : null;
  const zy = side.includes('s') ? (start.height + dy) / base.height
    : side.includes('n') ? (start.height - dy) / base.height : null;
  const zoom = zx !== null && zy !== null ? Math.max(zx, zy) : (zx ?? zy);
  const place = (width, height) => ({
    x: side.includes('w') ? start.x + start.width - width : start.x,
    y: side.includes('n') ? start.y + start.height - height : start.y,
  });
  return { zoom, place };
}

// Window top-left after zooming by `ratio` around a point at (ax, ay) inside
// a window whose top-left is `origin`: that point stays where it is on screen.
export function placeAround(origin, ax, ay, ratio) {
  return { x: origin.x + ax * (1 - ratio), y: origin.y + ay * (1 - ratio) };
}
