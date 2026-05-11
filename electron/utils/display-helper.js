// Multi-monitor helpers — bounds math, point/rect visibility, window-position layout.

const { screen } = require('electron');

// Union bounding box of all displays.
function getAllDisplaysBounds() {
  const displays = screen.getAllDisplays();

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  displays.forEach(display => {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height);
  });

  return {
    minX, minY, maxX, maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function isPointOnAnyDisplay(x, y) {
  const displays = screen.getAllDisplays();
  return displays.some(display => {
    const { x: dx, y: dy, width, height } = display.bounds;
    return x >= dx && x < dx + width && y >= dy && y < dy + height;
  });
}

// Bounds is "visible" if at least minVisiblePixels² overlaps some display.
function isBoundsVisible(bounds, minVisiblePixels = 50) {
  const displays = screen.getAllDisplays();

  for (const display of displays) {
    const db = display.bounds;

    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, db.x + db.width) - Math.max(bounds.x, db.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, db.y + db.height) - Math.max(bounds.y, db.y));
    const overlapArea = overlapX * overlapY;

    if (overlapArea >= minVisiblePixels * minVisiblePixels) {
      return true;
    }
  }

  return false;
}

function getNearestDisplay(x, y) {
  return screen.getDisplayNearestPoint({ x, y });
}

/**
 * Ensure window bounds land on a valid display. If invalid, either recenter on the
 * primary display or clamp to the nearest one.
 *
 * @returns {{ x, y, width, height, adjusted }} — `adjusted` true if bounds were moved.
 */
function ensureBoundsOnDisplay(bounds, options = {}) {
  const { minVisiblePixels = 100, centerOnInvalid = true } = options;

  // No position info → start centered on primary.
  if (bounds.x === undefined || bounds.y === undefined) {
    const primary = screen.getPrimaryDisplay();
    return {
      x: Math.round(primary.bounds.x + (primary.bounds.width - bounds.width) / 2),
      y: Math.round(primary.bounds.y + (primary.bounds.height - bounds.height) / 2),
      width: bounds.width,
      height: bounds.height,
      adjusted: true,
    };
  }

  if (isBoundsVisible(bounds, minVisiblePixels)) {
    return { ...bounds, adjusted: false };
  }

  if (centerOnInvalid) {
    const primary = screen.getPrimaryDisplay();
    return {
      x: Math.round(primary.bounds.x + (primary.bounds.width - bounds.width) / 2),
      y: Math.round(primary.bounds.y + (primary.bounds.height - bounds.height) / 2),
      width: bounds.width,
      height: bounds.height,
      adjusted: true,
    };
  } else {
    // Clamp to the nearest display's visible region.
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const nearestDisplay = getNearestDisplay(centerX, centerY);
    const db = nearestDisplay.bounds;

    let newX = Math.max(db.x, Math.min(bounds.x, db.x + db.width - bounds.width));
    let newY = Math.max(db.y, Math.min(bounds.y, db.y + db.height - bounds.height));

    return {
      x: Math.round(newX),
      y: Math.round(newY),
      width: bounds.width,
      height: bounds.height,
      adjusted: true,
    };
  }
}

// Constrain bounds inside the nearest display's workArea (excludes taskbar).
function constrainToScreen(bounds, margin = 10) {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const display = getNearestDisplay(centerX, centerY);
  const db = display.workArea;

  let { x, y, width, height } = bounds;

  width = Math.min(width, db.width - margin * 2);
  height = Math.min(height, db.height - margin * 2);

  x = Math.max(db.x + margin, Math.min(x, db.x + db.width - width - margin));
  y = Math.max(db.y + margin, Math.min(y, db.y + db.height - height - margin));

  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/**
 * Compute window position near a reference point (cursor by default). Flips to the
 * opposite side if the natural lower-right placement would overflow the screen.
 */
function getWindowPosition(size, position = null, options = {}) {
  const { offsetX = 20, offsetY = 20, margin = 10 } = options;

  let refX, refY;
  if (position && position.x !== undefined && position.y !== undefined) {
    refX = position.x;
    refY = position.y;
  } else {
    const cursor = screen.getCursorScreenPoint();
    refX = cursor.x;
    refY = cursor.y;
  }

  const display = getNearestDisplay(refX, refY);
  const db = display.workArea;

  // Initial placement: below-right of reference point.
  let x = refX + offsetX;
  let y = refY + offsetY;

  // Flip to left if overflowing right edge.
  if (x + size.width > db.x + db.width - margin) {
    x = refX - size.width - offsetX;
  }

  // Flip up if overflowing bottom edge.
  if (y + size.height > db.y + db.height - margin) {
    y = refY - size.height - offsetY;
  }

  // Final clamp to top-left.
  x = Math.max(db.x + margin, x);
  y = Math.max(db.y + margin, y);

  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Subscribe to display add/remove/changed events.
 * @returns {Function} Unsubscribe function.
 */
function onDisplayChange(callback) {
  const handleAdded = (event, display) => callback('added', display);
  const handleRemoved = (event, display) => callback('removed', display);
  const handleChanged = (event, display, changedMetrics) => callback('changed', display, changedMetrics);

  screen.on('display-added', handleAdded);
  screen.on('display-removed', handleRemoved);
  screen.on('display-metrics-changed', handleChanged);

  return () => {
    screen.removeListener('display-added', handleAdded);
    screen.removeListener('display-removed', handleRemoved);
    screen.removeListener('display-metrics-changed', handleChanged);
  };
}

// Single-line summary of all displays — for diagnostic logging.
function getDisplaySummary() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();

  return displays.map((d, i) => {
    const isPrimary = d.id === primary.id;
    return `[${i + 1}${isPrimary ? '*' : ''}] ${d.bounds.width}x${d.bounds.height} @${d.scaleFactor}x (${d.bounds.x},${d.bounds.y})`;
  }).join(' | ');
}

module.exports = {
  getAllDisplaysBounds,
  isPointOnAnyDisplay,
  isBoundsVisible,
  getNearestDisplay,
  ensureBoundsOnDisplay,
  constrainToScreen,
  getWindowPosition,
  onDisplayChange,
  getDisplaySummary,
};
