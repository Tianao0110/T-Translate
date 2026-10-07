// Docked-pin geometry for pin-windows.js: which screen edge a pin docks to,
// where each thumbnail goes in its edge's column, and where the hover preview
// opens. Pure; all values in DIP.

const DOCK_MARGIN = 6;
const DOCK_GAP = 6;
const PEEK_MAX_WIDTH = 0.6; // share of the work area
const PEEK_MAX_HEIGHT = 0.9;

// The work-area half the pin's center sits in.
function dockSide(bounds, workArea) {
  return bounds.x + bounds.width / 2 < workArea.x + workArea.width / 2 ? 'left' : 'right';
}

// Thumbnails in dock order down one edge; one that would run off the bottom
// stays at the bottom.
function stackSlots(sizes, side, workArea) {
  let y = workArea.y + DOCK_MARGIN;
  return sizes.map(({ width, height }) => {
    const x = side === 'left' ? workArea.x + DOCK_MARGIN : workArea.x + workArea.width - width - DOCK_MARGIN;
    const slot = { x, y: Math.min(y, workArea.y + workArea.height - height - DOCK_MARGIN), width, height };
    y += height + DOCK_GAP;
    return slot;
  });
}

// The preview: `size` capped to the work area, grown from the thumbnail
// toward the screen's middle and kept on screen, so it always covers the
// thumbnail it opened from.
function peekBounds(thumb, side, size, workArea) {
  const k = Math.min(1, (workArea.width * PEEK_MAX_WIDTH) / size.width, (workArea.height * PEEK_MAX_HEIGHT) / size.height);
  const width = Math.max(thumb.width, Math.round(size.width * k));
  const height = Math.max(thumb.height, Math.round(size.height * k));
  const x = side === 'left' ? thumb.x : thumb.x + thumb.width - width;
  const y = Math.max(workArea.y, Math.min(thumb.y, workArea.y + workArea.height - height));
  return { x, y, width, height };
}

module.exports = { dockSide, stackSlots, peekBounds, DOCK_MARGIN, DOCK_GAP };
