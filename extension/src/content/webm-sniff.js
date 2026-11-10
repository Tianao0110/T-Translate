// Media times in an MSE append without demuxing it: each Cluster's Timecode
// (the element right after the Cluster header in every muxer we have seen)
// scaled by the init segment's TimecodeScale. Used for evidence and to label
// what the relay forwards, never to cut the stream.

const CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
const TIMECODE_SCALE = [0x2a, 0xd7, 0xb1];
const TIMECODE = 0xe7;
export const DEFAULT_TIMECODE_SCALE = 1000000; // ns per tick

// { length, value } of the EBML variable-size integer at i, or null.
function vint(u8, i) {
  const b = u8[i];
  if (!b) return null;
  let len = 1;
  while (len <= 8 && !(b & (0x80 >> (len - 1)))) len++;
  if (len > 8 || i + len > u8.length) return null;
  let value = b & (0xff >> len);
  for (let k = 1; k < len; k++) value = value * 256 + u8[i + k];
  return { length: len, value };
}

function uint(u8, i, n) {
  if (n < 1 || n > 8 || i + n > u8.length) return null;
  let v = 0;
  for (let k = 0; k < n; k++) v = v * 256 + u8[i + k];
  return v;
}

const at = (u8, i, pattern) => pattern.every((b, k) => u8[i + k] === b);

// TimecodeScale from an init segment, or null when it has none.
export function timecodeScale(u8) {
  for (let i = 0; i + 4 < u8.length; i++) {
    if (!at(u8, i, TIMECODE_SCALE)) continue;
    const size = vint(u8, i + 3);
    const v = size && uint(u8, i + 3 + size.length, size.value);
    if (v) return v;
  }
  return null;
}

// Seconds of the first and last Cluster in u8, or null when it holds none.
export function clusterTimes(u8, scale = DEFAULT_TIMECODE_SCALE) {
  let first = null;
  let last = null;
  for (let i = 0; i + 6 < u8.length; i++) {
    if (!at(u8, i, CLUSTER)) continue;
    const size = vint(u8, i + 4);
    if (!size) continue;
    const j = i + 4 + size.length;
    if (u8[j] !== TIMECODE) continue;
    const len = vint(u8, j + 1);
    const ticks = len ? uint(u8, j + 1 + len.length, len.value) : null;
    if (ticks === null) continue;
    const s = Math.round((ticks * scale) / 1e6) / 1000;
    if (first === null) first = s;
    last = s;
    i = j;
  }
  return first === null ? null : { first, last };
}
