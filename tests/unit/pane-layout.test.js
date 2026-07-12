// pane-layout: de-overlap policy — significant collisions only, minimal
// bidirectional shift, capped drift (anchor fidelity beats zero overlap).

import { describe, it, expect } from 'vitest';
import { resolveOverlaps } from '../../src/services/pane-layout.js';

const rect = (id, x, y, w, h) => ({ id, x, y, w, h });

describe('resolveOverlaps', () => {
  it('leaves non-overlapping and side-by-side panes alone', () => {
    const moves = resolveOverlaps([
      rect('a', 0, 0, 200, 30),
      rect('b', 220, 0, 200, 30),
      rect('c', 0, 40, 200, 30),
    ]);
    expect(moves.size).toBe(0);
  });

  it('tolerates a slight edge kiss (below the significance threshold)', () => {
    // 8px of 30px height overlap ≈ 27% of the smaller pane — keep the anchor
    const moves = resolveOverlaps([
      rect('a', 0, 0, 200, 30),
      rect('b', 0, 22, 200, 30),
    ]);
    expect(moves.size).toBe(0);
  });

  it('shifts a significantly overlapped pane just below the collider', () => {
    const moves = resolveOverlaps([
      rect('a', 0, 0, 200, 30),
      rect('b', 0, 5, 200, 30),
    ]);
    expect(moves.get('b')).toBe(34); // a.bottom + 4px gap
  });

  it('shifts upward when that is the nearer clear spot', () => {
    // Small pane swallowed by a tall one: below = +99px (over cap), above fits
    const moves = resolveOverlaps([
      rect('big', 0, 40, 200, 100),
      rect('small', 0, 45, 200, 20),
    ]);
    expect(moves.get('small')).toBe(16); // big.top - own height - gap
  });

  it('gives up (keeps the overlap) when every clear spot exceeds the drift cap', () => {
    // Tall collider starts at 0: no room above, below is 99px away > 1.5×20
    const moves = resolveOverlaps([
      rect('big', 0, 0, 200, 100),
      rect('small', 0, 5, 200, 20),
    ]);
    expect(moves.size).toBe(0);
  });

  it('resolves a tight stack without cascading panes off their anchors', () => {
    // Three 30px panes at 22px pitch: only genuinely colliding pairs move,
    // every move stays within its own cap
    const rects = [
      rect('a', 0, 0, 200, 30),
      rect('b', 0, 22, 200, 30),
      rect('c', 0, 44, 200, 30),
    ];
    const moves = resolveOverlaps(rects);
    for (const [id, y] of moves) {
      const orig = rects.find(r => r.id === id);
      expect(Math.abs(y - orig.y)).toBeLessThanOrEqual(30 * 1.5);
    }
  });
});
