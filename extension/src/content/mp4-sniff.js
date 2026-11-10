// Media times in an fMP4 append without demuxing it: the audio track's
// timescale from the init segment's moov, each moof's tfdt scaled by it.
// Walks top-level boxes from the start of the append and stops at the first
// one that does not fit. Used for evidence and to label what the relay
// forwards, never to cut the stream.

const type4 = (u8, i) => String.fromCharCode(u8[i], u8[i + 1], u8[i + 2], u8[i + 3]);
const u32 = (u8, i) => ((u8[i] << 24) >>> 0) + (u8[i + 1] << 16) + (u8[i + 2] << 8) + u8[i + 3];

// [type, payload start, end] of each box in [from, to); stops at a bad or cut-off size.
function* boxes(u8, from, to) {
  for (let p = from; p + 8 <= to; ) {
    let size = u32(u8, p);
    let head = 8;
    if (size === 1) {
      if (p + 16 > to) return;
      size = u32(u8, p + 8) * 2 ** 32 + u32(u8, p + 12);
      head = 16;
    } else if (size === 0) size = to - p;
    if (size < head || p + size > to) return;
    yield [type4(u8, p + 4), p + head, p + size];
    p += size;
  }
}

const child = (u8, from, to, type) => {
  for (const b of boxes(u8, from, to)) if (b[0] === type) return b;
  return null;
};

// Timescale of the moov's sound track (else its first track), or null.
export function mp4Timescale(u8) {
  const moov = child(u8, 0, u8.length, 'moov');
  if (!moov) return null;
  let first = null;
  for (const [type, a, b] of boxes(u8, moov[1], moov[2])) {
    if (type !== 'trak') continue;
    const mdia = child(u8, a, b, 'mdia');
    const mdhd = mdia && child(u8, mdia[1], mdia[2], 'mdhd');
    if (!mdhd) continue;
    const at = mdhd[1] + (u8[mdhd[1]] === 1 ? 20 : 12);
    if (at + 4 > mdhd[2]) continue;
    const scale = u32(u8, at);
    if (!scale) continue;
    const hdlr = child(u8, mdia[1], mdia[2], 'hdlr');
    if (hdlr && hdlr[1] + 12 <= hdlr[2] && type4(u8, hdlr[1] + 8) === 'soun') return scale;
    first ??= scale;
  }
  return first;
}

// Seconds of the first and last moof's base media decode time, or null.
export function fragmentTimes(u8, timescale) {
  if (!(timescale > 0)) return null;
  let first = null;
  let last = null;
  for (const [type, a, b] of boxes(u8, 0, u8.length)) {
    if (type !== 'moof') continue;
    const traf = child(u8, a, b, 'traf');
    const tfdt = traf && child(u8, traf[1], traf[2], 'tfdt');
    if (!tfdt) continue;
    const v1 = u8[tfdt[1]] === 1;
    if (tfdt[1] + (v1 ? 12 : 8) > tfdt[2]) continue;
    const ticks = v1 ? u32(u8, tfdt[1] + 4) * 2 ** 32 + u32(u8, tfdt[1] + 8) : u32(u8, tfdt[1] + 4);
    const s = Math.round((ticks / timescale) * 1000) / 1000;
    first ??= s;
    last = s;
  }
  return first === null ? null : { first, last };
}
