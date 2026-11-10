// MP4 box readers and the sample table of a progressive (non-fragmented)
// file's audio track. The service worker uses the table to know which bytes
// hold which seconds (sw/direct-fetch.js), the offscreen demuxer to cut
// samples out of mdat bytes (offscreen/mp4-progressive.js); the fragmented
// demuxer (offscreen/mp4-demux.js) shares the box and sample-entry readers.
// Plain JS, no DOM.

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
// About six hours of 44.1 kHz AAC; past that the table would cost too much memory.
export const MAX_SAMPLES = 1 << 20;

export const type4 = (u8, i) => String.fromCharCode(u8[i], u8[i + 1], u8[i + 2], u8[i + 3]);
export const u16 = (u8, i) => (u8[i] << 8) | u8[i + 1];
export const u24 = (u8, i) => (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
export const u32 = (u8, i) => ((u8[i] << 24) >>> 0) + (u8[i + 1] << 16) + (u8[i + 2] << 8) + u8[i + 3];
export const s32 = (u8, i) => (u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3];
export const u64 = (u8, i) => u32(u8, i) * 2 ** 32 + u32(u8, i + 4);
export const printable = (u8, i) => u8[i] >= 0x20 && u8[i] <= 0x7e && u8[i + 1] >= 0x20 && u8[i + 1] <= 0x7e && u8[i + 2] >= 0x20 && u8[i + 2] <= 0x7e && u8[i + 3] >= 0x20 && u8[i + 3] <= 0x7e;

export function need(ok, message) {
  if (!ok) throw new Error(message);
}

// [type, payload start, end] of every box in [from, to); throws when one overruns.
export function kids(u8, from, to) {
  const out = [];
  for (let p = from; p + 8 <= to; ) {
    let size = u32(u8, p);
    let head = 8;
    if (size === 1) {
      need(p + 16 <= to, 'short box header');
      size = u64(u8, p + 8);
      head = 16;
    } else if (size === 0) size = to - p;
    need(size >= head && p + size <= to, `${type4(u8, p + 4)} overruns its parent`);
    out.push([type4(u8, p + 4), p + head, p + size]);
    p += size;
  }
  return out;
}

export const find = (list, type) => list.find((b) => b[0] === type) || null;

// { objectType, sampleRate, channels } of an MPEG-4 AudioSpecificConfig
// (objectType is the signalled one: 5 or 29 for explicit HE-AAC).
export function parseAudioSpecificConfig(asc) {
  let bit = 0;
  const read = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++, bit++) {
      const byte = asc[bit >> 3];
      need(byte !== undefined, 'short AudioSpecificConfig');
      v = v * 2 + ((byte >> (7 - (bit & 7))) & 1);
    }
    return v;
  };
  const aot = () => {
    const a = read(5);
    return a === 31 ? 32 + read(6) : a;
  };
  const rate = () => {
    const i = read(4);
    return i === 15 ? read(24) : AAC_RATES[i] || 0;
  };
  const objectType = aot();
  const sampleRate = rate();
  const channels = read(4);
  return { objectType, sampleRate, channels };
}

// { oti, asc } from an esds payload (after its version and flags).
function readEsds(u8, from, to) {
  let p = from;
  const desc = (tag) => {
    need(p < to && u8[p] === tag, `esds: no descriptor ${tag}`);
    p++;
    let len = 0;
    for (let i = 0; i < 4; i++) {
      need(p < to, 'esds: short descriptor');
      const b = u8[p++];
      len = len * 128 + (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    need(p + len <= to, 'esds: descriptor overruns');
    return p + len;
  };
  desc(0x03);
  p += 2;
  const flags = u8[p++];
  if (flags & 0x80) p += 2;
  if (flags & 0x40) p += 1 + u8[p];
  if (flags & 0x20) p += 2;
  desc(0x04);
  const oti = u8[p];
  p += 13;
  if (u8[p] !== 0x05) return { oti, asc: null };
  const end = desc(0x05);
  return { oti, asc: u8.slice(p, end) };
}

// codec, channels, sampleRate, codecPrivate of a sample entry (an
// AudioSampleEntry); other entries than mp4a come out under their own name
// for the decoder to refuse.
export function readSampleEntry(u8, type, a, b) {
  need(a + 28 <= b, `short ${type}`);
  const version = u16(u8, a + 8);
  let channels = u16(u8, a + 16);
  let sampleRate = u32(u8, a + 24) >>> 16;
  let from = a + 28;
  if (version === 1) from += 16;
  else if (version === 2) {
    need(a + 64 <= b, 'short mp4a v2');
    sampleRate = new DataView(u8.buffer, u8.byteOffset + a + 32, 8).getFloat64(0);
    channels = u32(u8, a + 40);
    from += 36;
  }
  const rest = { channels: channels || 1, sampleRate: Math.round(sampleRate) || 48000 };
  if (type !== 'mp4a') return { codec: type.trim(), ...rest, codecPrivate: null };
  let list = kids(u8, from, b);
  const wave = find(list, 'wave');
  if (wave) list = list.concat(kids(u8, wave[1], wave[2]));
  const esds = find(list, 'esds');
  const { oti, asc } = esds ? readEsds(u8, esds[1] + 4, esds[2]) : { oti: 0x40, asc: null };
  let codec = 'mp4a';
  if (asc?.length) {
    const cfg = parseAudioSpecificConfig(asc);
    codec = oti === 0x40 ? `mp4a.40.${cfg.objectType}` : `mp4a.${oti.toString(16)}`;
    sampleRate ||= cfg.sampleRate;
    channels ||= cfg.channels;
  }
  return { codec, channels: channels || 1, sampleRate: Math.round(sampleRate) || 48000, codecPrivate: asc?.length ? asc : null };
}

// A sound trak: { id, timescale, codec, channels, sampleRate, codecPrivate,
// stbl: [type, a, b][] | null, edts }, or null for any other track.
export function readSoundTrak(u8, a, b) {
  const list = kids(u8, a, b);
  const tkhd = find(list, 'tkhd');
  const mdia = find(list, 'mdia');
  if (!tkhd || !mdia) return null;
  const id = u32(u8, tkhd[1] + (u8[tkhd[1]] === 1 ? 20 : 12));
  const ml = kids(u8, mdia[1], mdia[2]);
  const mdhd = find(ml, 'mdhd');
  const hdlr = find(ml, 'hdlr');
  if (!mdhd || !hdlr || type4(u8, hdlr[1] + 8) !== 'soun') return null;
  const timescale = u32(u8, mdhd[1] + (u8[mdhd[1]] === 1 ? 20 : 12));
  const minf = find(ml, 'minf');
  const stblBox = minf && find(kids(u8, minf[1], minf[2]), 'stbl');
  const stbl = stblBox ? kids(u8, stblBox[1], stblBox[2]) : null;
  const stsd = stbl && find(stbl, 'stsd');
  const entry = stsd && kids(u8, stsd[1] + 8, stsd[2])[0];
  if (!id || !timescale || !entry) return null;
  return { id, timescale, ...readSampleEntry(u8, entry[0], entry[1], entry[2]), stbl, edts: find(list, 'edts') };
}

// Media time (ms) the first non-empty edit starts at; 0 without an edit list.
function editOffsetMs(u8, edts, timescale) {
  const elst = edts && find(kids(u8, edts[1], edts[2]), 'elst');
  if (!elst) return 0;
  const v = u8[elst[1]];
  const count = u32(u8, elst[1] + 4);
  const size = v === 1 ? 20 : 12;
  for (let i = 0, p = elst[1] + 8; i < count && p + size <= elst[2]; i++, p += size) {
    const mediaTime = v === 1 ? u64(u8, p + 8) : s32(u8, p + 4);
    // v1 empty edits are all ones; u64 turns them into a huge number.
    if (mediaTime >= 0 && mediaTime < 2 ** 52) return (mediaTime / timescale) * 1000;
  }
  return 0;
}

function sampleSizes(u8, stbl) {
  const stsz = find(stbl, 'stsz');
  if (stsz) {
    const p = stsz[1];
    const fixed = u32(u8, p + 4);
    const count = u32(u8, p + 8);
    need(count <= MAX_SAMPLES, 'too many samples');
    if (fixed) return new Uint32Array(count).fill(fixed);
    need(p + 12 + count * 4 <= stsz[2], 'stsz overruns');
    const out = new Uint32Array(count);
    for (let i = 0; i < count; i++) out[i] = u32(u8, p + 12 + i * 4);
    return out;
  }
  const stz2 = find(stbl, 'stz2');
  need(stz2, 'no stsz');
  const p = stz2[1];
  const field = u8[p + 7];
  const count = u32(u8, p + 8);
  need(count <= MAX_SAMPLES, 'too many samples');
  need(field === 4 || field === 8 || field === 16, 'bad stz2 field size');
  need(p + 12 + Math.ceil((count * field) / 8) <= stz2[2], 'stz2 overruns');
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    if (field === 16) out[i] = u16(u8, p + 12 + i * 2);
    else if (field === 8) out[i] = u8[p + 12 + i];
    else out[i] = (u8[p + 12 + (i >> 1)] >> (i & 1 ? 0 : 4)) & 0xf;
  }
  return out;
}

function chunkOffsets(u8, stbl) {
  const co = find(stbl, 'stco') || find(stbl, 'co64');
  need(co, 'no stco');
  const wide = co[0] === 'co64';
  const count = u32(u8, co[1] + 4);
  need(co[1] + 8 + count * (wide ? 8 : 4) <= co[2], `${co[0]} overruns`);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) out[i] = wide ? u64(u8, co[1] + 8 + i * 8) : u32(u8, co[1] + 8 + i * 4);
  return out;
}

// [{ offset, size, timeMs }] in sample order, from stsz / stz2, stsc + stco / co64 and stts.
function buildSamples(u8, stbl, timescale) {
  const sizes = sampleSizes(u8, stbl);
  const chunks = chunkOffsets(u8, stbl);
  const stsc = find(stbl, 'stsc');
  const stts = find(stbl, 'stts');
  need(stsc && stts, 'no stsc / stts');
  const scCount = u32(u8, stsc[1] + 4);
  need(stsc[1] + 8 + scCount * 12 <= stsc[2], 'stsc overruns');
  const tsCount = u32(u8, stts[1] + 4);
  need(stts[1] + 8 + tsCount * 8 <= stts[2], 'stts overruns');

  const n = sizes.length;
  const samples = new Array(n);
  let s = 0;
  for (let e = 0; e < scCount && s < n; e++) {
    const p = stsc[1] + 8 + e * 12;
    const first = u32(u8, p) - 1;
    const perChunk = u32(u8, p + 4);
    const last = e + 1 < scCount ? u32(u8, p + 12) - 1 : chunks.length;
    need(first >= 0 && perChunk > 0, 'bad stsc');
    for (let c = first; c < last && c < chunks.length && s < n; c++) {
      let at = chunks[c];
      for (let k = 0; k < perChunk && s < n; k++, s++) {
        samples[s] = { offset: at, size: sizes[s], timeMs: 0 };
        at += sizes[s];
      }
    }
  }
  need(s === n, 'stsc covers fewer samples than stsz');

  let t = 0;
  let i = 0;
  for (let e = 0; e < tsCount && i < n; e++) {
    const p = stts[1] + 8 + e * 8;
    const count = u32(u8, p);
    const delta = u32(u8, p + 4);
    for (let k = 0; k < count && i < n; k++, i++) {
      samples[i].timeMs = (t / timescale) * 1000;
      t += delta;
    }
  }
  // A short stts: the rest keep the last delta's pace.
  const last = tsCount ? u32(u8, stts[1] + 8 + (tsCount - 1) * 8 + 4) : 1024;
  for (; i < n; i++, t += last) samples[i].timeMs = (t / timescale) * 1000;
  return { samples, durationMs: (t / timescale) * 1000 };
}

// Top-level { type, offset, size, head } boxes of u8; a box running past the
// bytes ends the list (it is the last one returned, cut short), so does a
// header that cannot be one.
export function topBoxes(u8) {
  const out = [];
  for (let p = 0; p + 8 <= u8.length; ) {
    let size = u32(u8, p);
    let head = 8;
    if (size === 1) {
      if (p + 16 > u8.length) break;
      size = u64(u8, p + 8);
      head = 16;
    } else if (size === 0) size = Infinity;
    if (size < head || !printable(u8, p + 4)) break;
    out.push({ type: type4(u8, p + 4), offset: p, size, head });
    p += size;
  }
  return out;
}

// The audio track's table from bytes holding a whole moov box (alone, after
// ftyp, or anywhere among top-level boxes); base is the file offset of u8[0].
// Throws when there is no complete moov or no sound track in it.
export function parseMoov(u8, { base = 0 } = {}) {
  const boxes = topBoxes(u8);
  const moov = boxes.find((b) => b.type === 'moov');
  need(moov && moov.offset + moov.size <= u8.length, 'no complete moov');
  let t = null;
  for (const [type, a, b] of kids(u8, moov.offset + moov.head, moov.offset + moov.size)) {
    if (type !== 'trak') continue;
    t = readSoundTrak(u8, a, b);
    if (t) break;
  }
  need(t && t.stbl, 'no sound track');
  const { samples, durationMs } = buildSamples(u8, t.stbl, t.timescale);
  need(samples.length > 0, 'no audio samples');
  samples.sort((x, y) => x.offset - y.offset || x.timeMs - y.timeMs);
  let total = 0;
  for (const s of samples) total += s.size;
  const mdat = boxes.find((b) => b.type === 'mdat');
  return {
    track: { number: t.id, codec: t.codec, channels: t.channels, sampleRate: t.sampleRate, codecPrivate: t.codecPrivate, timescale: t.timescale, editOffsetMs: editOffsetMs(u8, t.edts, t.timescale) },
    samples,
    durationMs,
    bytesPerSecond: durationMs > 0 ? Math.round(total / (durationMs / 1000)) : 0,
    mdat: mdat && Number.isFinite(mdat.size) ? { offset: base + mdat.offset, end: base + mdat.offset + mdat.size } : null,
  };
}

// Index of the first sample at or after timeMs (samples.length when none).
export function indexAtTime(table, timeMs) {
  const s = table.samples;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].timeMs < timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Index of the first sample starting at or after a file offset.
export function indexAtOffset(table, offset) {
  const s = table.samples;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].offset < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// File offset of the first sample at or after timeS, or null past the end.
export function offsetAt(table, timeS) {
  const i = indexAtTime(table, Math.max(0, timeS) * 1000);
  return i < table.samples.length ? table.samples[i].offset : null;
}

// The top-level boxes at the head of a file and where its moov is: 'head'
// when it comes before mdat (moov is then its box), 'tail' when mdat comes
// first (moovOffset is where mdat ends, where the moov most likely starts),
// null when neither shows in these bytes.
export function probeHead(u8) {
  const boxes = topBoxes(u8).map(({ type, offset, size }) => ({ type, offset, size }));
  const moov = boxes.find((b) => b.type === 'moov') || null;
  const mdat = boxes.find((b) => b.type === 'mdat') || null;
  if (moov && (!mdat || moov.offset < mdat.offset)) return { boxes, where: 'head', moov, mdat, moovOffset: moov.offset };
  if (mdat && Number.isFinite(mdat.size)) return { boxes, where: 'tail', moov: null, mdat, moovOffset: mdat.offset + mdat.size };
  return { boxes, where: null, moov: null, mdat, moovOffset: null };
}
