// Zoom geometry for pinned screenshots (components/PinWindow/zoom.js): the
// edge under a point, edge drags that keep the opposite side fixed and the
// aspect locked, and wheel steps that keep the point under the cursor still.

import { describe, it, expect } from 'vitest';
import { edgeAt, zoomFromEdge, placeAround } from '../../../src/components/PinWindow/zoom.js';

const base = { width: 400, height: 200 };
const start = { x: 100, y: 50, width: 400, height: 200 };

describe('edgeAt', () => {
  it('names sides and corners within the band, nothing inside', () => {
    expect(edgeAt(200, 100, 400, 200, 6)).toBe('');
    expect(edgeAt(398, 100, 400, 200, 6)).toBe('e');
    expect(edgeAt(2, 100, 400, 200, 6)).toBe('w');
    expect(edgeAt(200, 2, 400, 200, 6)).toBe('n');
    expect(edgeAt(398, 198, 400, 200, 6)).toBe('se');
    expect(edgeAt(2, 2, 400, 200, 6)).toBe('nw');
  });
});

describe('zoomFromEdge', () => {
  it('right edge: width drives the zoom, top-left stays', () => {
    const { zoom, place } = zoomFromEdge('e', start, 200, 0, base);
    expect(zoom).toBe(1.5);
    expect(place(600, 300)).toEqual({ x: 100, y: 50 });
  });

  it('left edge: the right side stays put', () => {
    const { zoom, place } = zoomFromEdge('w', start, 100, 0, base);
    expect(zoom).toBe(0.75);
    expect(place(300, 150)).toEqual({ x: 200, y: 50 });
  });

  it('top-left corner: the larger change wins, bottom-right stays', () => {
    const { zoom, place } = zoomFromEdge('nw', start, -40, -100, base);
    expect(zoom).toBe(1.5);
    expect(place(600, 300)).toEqual({ x: -100, y: -50 });
  });

  it('bottom edge: height drives the zoom', () => {
    expect(zoomFromEdge('s', start, 0, -100, base).zoom).toBe(0.5);
  });
});

describe('placeAround', () => {
  it('keeps the anchor point on the same screen spot', () => {
    const origin = { x: 300, y: 200 };
    const ratio = 1.5;
    const next = placeAround(origin, 100, 40, ratio);
    // The content point under (100, 40) is now at (150, 60) inside the window.
    expect(next.x + 100 * ratio).toBeCloseTo(origin.x + 100);
    expect(next.y + 40 * ratio).toBeCloseTo(origin.y + 40);
  });
});
