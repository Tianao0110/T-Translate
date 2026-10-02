// Patch colors for pinned screenshots (components/PinWindow/patch-colors.js):
// background from the band around the box, text color from the far pixels inside.

import { describe, it, expect } from 'vitest';
import { patchColors } from '../../../src/components/PinWindow/patch-colors.js';

// width x height region filled with `bg`, the given pixels set to `ink`.
function region(width, height, bg, ink = [], inkPixels = []) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...bg, 255], i * 4);
  for (const [x, y] of inkPixels) data.set([...ink, 255], (y * width + x) * 4);
  return { data, width, height };
}

describe('patchColors', () => {
  it('reads dark text on a light background', () => {
    const r = region(20, 10, [250, 250, 250], [20, 30, 40], [[8, 4], [9, 4], [10, 5]]);
    expect(patchColors(r, { x: 3, y: 3, width: 14, height: 4 })).toEqual({
      background: 'rgb(250, 250, 250)',
      color: 'rgb(20, 30, 40)',
    });
  });

  it('reads light text on a dark background', () => {
    const r = region(20, 10, [21, 21, 21], [230, 230, 230], [[6, 5], [7, 5]]);
    expect(patchColors(r, { x: 3, y: 3, width: 14, height: 4 })).toEqual({
      background: 'rgb(21, 21, 21)',
      color: 'rgb(230, 230, 230)',
    });
  });

  it('falls back to a contrasting text color when nothing stands out', () => {
    expect(patchColors(region(10, 10, [240, 240, 240]), { x: 2, y: 2, width: 6, height: 6 }).color).toBe('rgb(17, 17, 17)');
    expect(patchColors(region(10, 10, [10, 10, 10]), { x: 2, y: 2, width: 6, height: 6 }).color).toBe('rgb(245, 245, 245)');
  });

  it('uses the box edge when the box fills the region', () => {
    const r = region(10, 6, [200, 220, 240], [0, 0, 0], [[4, 3]]);
    expect(patchColors(r, { x: 0, y: 0, width: 10, height: 6 }).background).toBe('rgb(200, 220, 240)');
  });
});
