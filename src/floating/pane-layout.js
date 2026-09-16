// De-overlap layout for scattered child panes. Pure — takes measured rects,
// returns the vertical moves — so the collision policy stays unit-testable.
//
// Anchor fidelity beats zero overlap: panes point at their source text, so we
// only resolve SIGNIFICANT collisions, shift the minimal distance (up or
// down), and give up beyond a cap rather than cascade panes away from their
// anchors (the greedy always-down pass drifted dense UI captures badly).

const DEFAULT_GAP = 4;
const MIN_OVERLAP_RATIO = 0.4; // intersection ≤ this share of the smaller pane is tolerated
const MAX_SHIFT_FACTOR = 1.5; // give up beyond this × own height from the anchor

function intersection(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function significantCollision(a, b, minRatio) {
  const inter = intersection(a, b);
  if (!inter) return false;
  return inter / Math.min(a.w * a.h, b.w * b.h) > minRatio;
}

/**
 * @param {Array<{id, x, y, w, h}>} rects - measured pane frames (same coord space)
 * @returns {Map<id, number>} new y for panes that should move
 */
export function resolveOverlaps(rects, {
  gap = DEFAULT_GAP,
  minOverlapRatio = MIN_OVERLAP_RATIO,
  maxShiftFactor = MAX_SHIFT_FACTOR,
} = {}) {
  const moves = new Map();
  const placed = [];
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const r of sorted) {
    const cur = { ...r };
    const colliders = placed.filter(p => significantCollision(cur, p, minOverlapRatio));
    if (colliders.length) {
      // Candidates: just below or just above each collider — pick the nearest
      // position (to the anchor) that clears every placed pane and stays
      // within the shift cap. No candidate qualifying = keep the overlap.
      const maxShift = cur.h * maxShiftFactor;
      const candidates = [];
      for (const p of colliders) {
        candidates.push(p.y + p.h + gap);
        candidates.push(p.y - cur.h - gap);
      }
      const ok = candidates
        .filter(y => y >= 0 && Math.abs(y - r.y) <= maxShift)
        .filter(y => !placed.some(p => significantCollision({ ...cur, y }, p, minOverlapRatio)))
        .sort((a, b) => Math.abs(a - r.y) - Math.abs(b - r.y));
      if (ok.length) {
        cur.y = ok[0];
        moves.set(cur.id, Math.round(cur.y));
      }
    }
    placed.push(cur);
  }
  return moves;
}
