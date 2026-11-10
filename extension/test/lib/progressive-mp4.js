// A hand-built progressive MP4 for the sample-table and direct-fetch tests:
// ftyp (16 bytes), then mdat with audio samples 10, 11, 12 bytes, `gap`
// bytes of video, audio 13, 14; then a moov with a video track and the sound
// track (two chunks, stsc 3 then 2 per chunk, an edit list starting the
// media at 1024 / 48000 s). Each audio sample's bytes are its 1-based index.

export const SIZES = [10, 11, 12, 13, 14];

const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const be = (v, n) => Array.from({ length: n }, (_, i) => Math.floor(v / 256 ** (n - 1 - i)) % 256);
const fourcc = (t) => [...t].map((c) => c.charCodeAt(0));
export const box = (type, ...kids) => {
  const body = cat(...kids);
  return cat(be(body.length + 8, 4), fourcc(type), body);
};
export const full = (type, version, flags, ...kids) => box(type, [version, ...be(flags, 3)], ...kids);
export { be };

function esds(asc) {
  const dsi = [0x05, asc.length, ...asc];
  const dcd = [0x04, 13 + dsi.length, 0x40, 0x15, 0, 0, 0, ...be(64000, 4), ...be(64000, 4), ...dsi];
  return full('esds', 0, 0, [0x03, 3 + dcd.length + 3, 0, 1, 0, ...dcd, 0x06, 1, 2]);
}
const mp4a = () => box('mp4a', new Array(6).fill(0), be(1, 2), new Array(8).fill(0), be(1, 2), be(16, 2), be(0, 4), be(48000 * 65536, 4), esds([0x11, 0x88]));

export function trak(id, handler, stbl, edts = []) {
  return box(
    'trak',
    full('tkhd', 0, 3, be(0, 8), be(id, 4), new Array(68).fill(0)),
    ...edts,
    box('mdia', full('mdhd', 0, 0, be(0, 8), be(48000, 4), be(0, 4), be(0, 4)), full('hdlr', 0, 0, be(0, 4), fourcc(handler), new Array(13).fill(0)), box('minf', box('stbl', ...stbl)))
  );
}

export const videoTrak = (id) => trak(id, 'vide', [full('stsd', 0, 0, be(1, 4), box('avc1', new Array(78).fill(0)))]);
export const moovOf = (...traks) => box('moov', full('mvhd', 0, 0, new Array(96).fill(0)), ...traks);

export function handBuilt({ wide = false, compact = false, gap = 100 } = {}) {
  const ftyp = box('ftyp', fourcc('isom'), be(0, 4));
  const payload = [];
  SIZES.slice(0, 3).forEach((n, i) => payload.push(...new Array(n).fill(i + 1)));
  payload.push(...new Array(gap).fill(0xee));
  SIZES.slice(3).forEach((n, i) => payload.push(...new Array(n).fill(i + 4)));
  const mdat = box('mdat', payload);
  const c1 = ftyp.length + 8;
  const c2 = c1 + 33 + gap;
  const sizes = compact ? full('stz2', 0, 0, [0, 0, 0, 8], be(5, 4), SIZES) : full('stsz', 0, 0, be(0, 4), be(5, 4), ...SIZES.map((n) => be(n, 4)));
  const offsets = wide ? full('co64', 0, 0, be(2, 4), be(c1, 8), be(c2, 8)) : full('stco', 0, 0, be(2, 4), be(c1, 4), be(c2, 4));
  const stbl = [full('stsd', 0, 0, be(1, 4), mp4a()), full('stts', 0, 0, be(1, 4), be(5, 4), be(1024, 4)), full('stsc', 0, 0, be(2, 4), be(1, 4), be(3, 4), be(1, 4), be(2, 4), be(2, 4), be(1, 4)), sizes, offsets];
  // An empty edit, then the media from 1024 / 48000 s.
  const elst = box('edts', full('elst', 0, 0, be(2, 4), be(500, 4), [255, 255, 255, 255], be(1, 4), be(5000, 4), be(1024, 4), be(1, 4)));
  const moov = moovOf(videoTrak(1), trak(2, 'soun', stbl, [elst]));
  return { file: cat(ftyp, mdat, moov), c1, c2, mdatEnd: ftyp.length + mdat.length };
}
