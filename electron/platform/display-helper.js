// Multi-monitor helpers — bounds math, point/rect visibility, window-position layout.

const { screen } = require('electron');

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
 * Normalize a persisted window position to `{ x, y }`.
 *
 * Builds up to v0.3.3 stored `BrowserWindow.getPosition()` verbatim — an [x, y]
 * array — while the read side took `.x` / `.y` off it. That silently yielded
 * undefined, so every launch fell through to "no position info" and recentred
 * the window. Both shapes are accepted so existing installs keep their spot.
 *
 * @returns {{ x?: number, y?: number }} — empty when nothing usable was stored.
 */
function normalizeWindowPosition(stored) {
  if (Array.isArray(stored)) {
    const [x, y] = stored;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : {};
  }
  if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
    return { x: stored.x, y: stored.y };
  }
  return {};
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
  normalizeWindowPosition,
  ensureBoundsOnDisplay,
  onDisplayChange,
  getDisplaySummary,
};
