// Docked pins (electron/screenshot/dock-layout.js): the nearer left / right
// edge, thumbnails stacked top-down, and a hover preview that grows toward
// the middle, stays on screen and always covers its thumbnail.

import { describe, it, expect } from 'vitest';
import layout from '../../../electron/screenshot/dock-layout.js';

const { dockSide, stackSlots, peekBounds, DOCK_MARGIN, DOCK_GAP } = layout;
const wa = { x: 0, y: 0, width: 1400, height: 880 };

const covers = (outer, inner) =>
  outer.x <= inner.x && outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width &&
  outer.y + outer.height >= inner.y + inner.height;

describe('dockSide', () => {
  it('follows the half the pin center is in', () => {
    expect(dockSide({ x: 100, y: 0, width: 300, height: 100 }, wa)).toBe('left');
    expect(dockSide({ x: 900, y: 0, width: 300, height: 100 }, wa)).toBe('right');
  });

  it('works on a display left of the primary', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1040 };
    expect(dockSide({ x: -1800, y: 10, width: 200, height: 80 }, left)).toBe('left');
    expect(dockSide({ x: -300, y: 10, width: 200, height: 80 }, left)).toBe('right');
  });
});

describe('stackSlots', () => {
  it('stacks top-down along the edge with a gap', () => {
    const slots = stackSlots([{ width: 120, height: 40 }, { width: 90, height: 120 }], 'right', wa);
    expect(slots[0]).toEqual({ x: 1400 - 120 - DOCK_MARGIN, y: DOCK_MARGIN, width: 120, height: 40 });
    expect(slots[1]).toEqual({ x: 1400 - 90 - DOCK_MARGIN, y: DOCK_MARGIN + 40 + DOCK_GAP, width: 90, height: 120 });
  });

  it('keeps an overflowing thumbnail at the bottom of the work area', () => {
    const many = Array.from({ length: 12 }, () => ({ width: 120, height: 100 }));
    const last = stackSlots(many, 'left', wa).at(-1);
    expect(last.x).toBe(DOCK_MARGIN);
    expect(last.y + last.height).toBe(wa.height - DOCK_MARGIN);
  });
});

describe('peekBounds', () => {
  it('grows inward from a left thumbnail and covers it', () => {
    const thumb = { x: 6, y: 300, width: 120, height: 60 };
    const peek = peekBounds(thumb, 'left', { width: 600, height: 300 }, wa);
    expect(peek).toEqual({ x: 6, y: 300, width: 600, height: 300 });
    expect(covers(peek, thumb)).toBe(true);
  });

  it('grows leftward from a right thumbnail and moves up to stay on screen', () => {
    const thumb = { x: 1274, y: 800, width: 120, height: 60 };
    const peek = peekBounds(thumb, 'right', { width: 600, height: 300 }, wa);
    expect(peek.x + peek.width).toBe(thumb.x + thumb.width);
    expect(peek.y + peek.height).toBeLessThanOrEqual(wa.height);
    expect(covers(peek, thumb)).toBe(true);
  });

  it('caps a huge pin to the work area, keeping its aspect', () => {
    const thumb = { x: 6, y: 6, width: 120, height: 68 };
    const peek = peekBounds(thumb, 'left', { width: 2800, height: 1600 }, wa);
    expect(peek.width).toBeLessThanOrEqual(wa.width * 0.6 + 1);
    expect(peek.width / peek.height).toBeCloseTo(2800 / 1600, 1);
  });
});
