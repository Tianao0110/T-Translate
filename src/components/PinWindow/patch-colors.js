// Colors for a translation patch, read from the captured image: the
// background is the dominant color of the band around the text box, the
// text color the pixels inside that stand furthest from it. Used by
// PinWindow/index.jsx; pure on ImageData-shaped input.

const MIN_TEXT_DISTANCE = 60;
const TEXT_SHARE = 0.2;

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const css = (c) => `rgb(${c.map((v) => Math.round(v)).join(', ')})`;
const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// Mean luminance (0–1) of an ImageData sample: the tone of the veil over a
// pin whose translation covers the whole image.
export function meanLuminance(region) {
  const { data } = region;
  const n = data.length / 4;
  if (!n) return 1;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += luminance([data[i], data[i + 1], data[i + 2]]);
  return sum / n;
}

// `region` is ImageData around the box; `box` is the text box inside it
// ({ x, y, width, height } in region pixels).
export function patchColors(region, box) {
  const { data, width, height } = region;
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const inside = (x, y) => x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height;
  const onEdge = (x, y) => x === box.x || y === box.y || x === box.x + box.width - 1 || y === box.y + box.height - 1;

  // Dominant color of the band by 4-bit buckets; the box's own edge when
  // the box fills the region.
  const dominant = (pick) => {
    const buckets = new Map();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!pick(x, y)) continue;
        const c = at(x, y);
        const key = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
        const b = buckets.get(key) || { n: 0, sum: [0, 0, 0] };
        b.n++;
        b.sum[0] += c[0]; b.sum[1] += c[1]; b.sum[2] += c[2];
        buckets.set(key, b);
      }
    }
    let top = null;
    for (const b of buckets.values()) if (!top || b.n > top.n) top = b;
    return top ? top.sum.map((s) => s / top.n) : null;
  };
  const bg = dominant((x, y) => !inside(x, y)) || dominant((x, y) => inside(x, y) && onEdge(x, y)) || [255, 255, 255];

  // Inner pixels far from the background, the furthest share averaged.
  const far = [];
  for (let y = Math.max(0, box.y); y < Math.min(height, box.y + box.height); y++) {
    for (let x = Math.max(0, box.x); x < Math.min(width, box.x + box.width); x++) {
      const c = at(x, y);
      const d = distance(c, bg);
      if (d >= MIN_TEXT_DISTANCE) far.push({ c, d });
    }
  }
  let fg;
  if (far.length) {
    far.sort((a, b) => b.d - a.d);
    const take = far.slice(0, Math.max(1, Math.ceil(far.length * TEXT_SHARE)));
    fg = [0, 1, 2].map((i) => take.reduce((s, p) => s + p.c[i], 0) / take.length);
  } else {
    fg = luminance(bg) > 0.5 ? [17, 17, 17] : [245, 245, 245];
  }

  return { background: css(bg), color: css(fg) };
}
