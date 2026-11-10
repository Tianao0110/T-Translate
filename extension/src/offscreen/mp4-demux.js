// Streaming fragmented-MP4 demuxer for the audio track: bytes cut anywhere
// in, the same track / block / error events as webm-demux.js out (to
// decode.js). Reads the init segment's moov (sound track, timescale, mp4a
// with its esds AudioSpecificConfig, trex defaults) and every moof + mdat;
// skips styp, sidx, free, emsg and the like by size; after bad data reports
// once and resyncs on the next moof or init segment. Plain JS so it runs
// under Node for tests.

import { type4, u24, u32, s32, u64, printable, need, kids, find, readSoundTrak } from '../shared/mp4-table.js';

export { parseAudioSpecificConfig } from '../shared/mp4-table.js';

const EMPTY = new Uint8Array(0);
const SKIP = new Set(['ftyp', 'styp', 'sidx', 'ssix', 'free', 'skip', 'emsg', 'prft', 'mfra', 'meta', 'uuid', 'pdin', 'wide', 'mdat']);
const SYNC = new Set(['moof', 'moov', 'ftyp', 'styp']);

function readTrak(u8, a, b) {
  const t = readSoundTrak(u8, a, b);
  return t && { id: t.id, timescale: t.timescale, codec: t.codec, channels: t.channels, sampleRate: t.sampleRate, codecPrivate: t.codecPrivate };
}

export function createMp4Demuxer({ maxBoxBytes = 16 * 1024 * 1024, maxUnknownBytes = 1024 * 1024 } = {}) {
  let buf = EMPTY;
  let off = 0; // read position in buf
  let base = 0; // stream offset of buf[0]
  let skip = 0; // bytes of a skipped box still to come
  let resync = false;
  let errored = false; // one error event per bad stretch
  let tracks = new Map(); // track id → sound track
  let defaults = new Map(); // track id → trex { duration, size }
  let moof = null; // samples waiting for their mdat
  let out = [];

  const pos = () => base + off;

  function report(message) {
    if (!errored) out.push({ type: 'error', message });
    errored = true;
  }

  function fail(message) {
    report(message);
    resync = true;
    skip = 0;
    moof = null;
    off += 1; // never resync onto the box that just failed
  }

  // Next moof or init segment at or after off; keeps a 7-byte tail so a header split across pushes is found.
  function findSync() {
    for (let i = off; i + 8 <= buf.length; i++) {
      if (!SYNC.has(type4(buf, i + 4))) continue;
      const size = u32(buf, i);
      if (size >= 8 && size <= maxBoxBytes) {
        off = i;
        resync = false;
        return true;
      }
    }
    off = Math.max(off, buf.length - 7);
    return false;
  }

  // { type, size, head }, null when more bytes are needed, { bad } when invalid.
  function readHeader() {
    const avail = buf.length - off;
    if (avail < 8) return null;
    if (!printable(buf, off + 4)) return { bad: 'bad box type' };
    const type = type4(buf, off + 4);
    let size = u32(buf, off);
    let head = 8;
    if (size === 1) {
      if (avail < 16) return null;
      size = u64(buf, off + 8);
      head = 16;
    } else if (size === 0) return { bad: `${type} runs to the end of the stream` };
    if (size < head) return { bad: 'bad box size' };
    return { type, size, head };
  }

  function onMoov(u8, from, to) {
    const found = [];
    const trex = new Map();
    for (const [type, a, b] of kids(u8, from, to)) {
      if (type === 'trak') {
        const t = readTrak(u8, a, b);
        if (t) found.push(t);
      } else if (type === 'mvex') {
        for (const [t2, c, d] of kids(u8, a, b)) if (t2 === 'trex' && d - c >= 20) trex.set(u32(u8, c + 4), { duration: u32(u8, c + 12), size: u32(u8, c + 16) });
      }
    }
    tracks = new Map();
    defaults = trex;
    moof = null;
    for (const t of found) {
      tracks.set(t.id, { ...t, nextTime: 0 });
      out.push({ type: 'track', number: t.id, codec: t.codec, channels: t.channels, sampleRate: t.sampleRate, codecPrivate: t.codecPrivate });
      errored = false;
    }
  }

  // One traf: its samples' stream (or file) positions and media times.
  function readTraf(u8, a, b, moofAt, implicitBase, samples) {
    const list = kids(u8, a, b);
    const tfhd = find(list, 'tfhd');
    need(tfhd && tfhd[2] - tfhd[1] >= 8, 'traf without tfhd');
    let p = tfhd[1];
    const flags = u24(u8, p + 1);
    const id = u32(u8, p + 4);
    p += 8;
    const take = (n) => {
      need(p + n <= tfhd[2], 'short tfhd');
      p += n;
      return p - n;
    };
    const bdo = flags & 0x1 ? u64(u8, take(8)) : null;
    if (flags & 0x2) take(4);
    const defDur = flags & 0x8 ? u32(u8, take(4)) : null;
    const defSize = flags & 0x10 ? u32(u8, take(4)) : null;
    const track = tracks.get(id);
    const trex = defaults.get(id) || {};
    const fileRel = bdo !== null;
    const start = fileRel ? bdo : flags & 0x20000 ? moofAt : implicitBase;
    const tfdt = find(list, 'tfdt');
    let time = tfdt ? (u8[tfdt[1]] === 1 ? u64(u8, tfdt[1] + 4) : u32(u8, tfdt[1] + 4)) : (track?.nextTime ?? 0);
    // AAC frames are 1024 samples when nothing says otherwise.
    const duration = defDur ?? (trex.duration || (track ? Math.round((1024 * track.timescale) / (track.sampleRate || track.timescale)) : 0));
    const size = defSize ?? trex.size ?? 0;
    let data = start;
    let first = null;
    for (const [type, c, d] of list) {
      if (type !== 'trun') continue;
      const version = u8[c];
      const tf = u24(u8, c + 1);
      const count = u32(u8, c + 4);
      let q = c + 8;
      if (tf & 0x1) {
        data = start + s32(u8, q);
        q += 4;
      }
      if (tf & 0x4) q += 4;
      const stride = 4 * (((tf >> 8) & 1) + ((tf >> 9) & 1) + ((tf >> 10) & 1) + ((tf >> 11) & 1));
      need(count < 1e6 && q + count * stride <= d, 'trun overruns');
      first ??= data;
      for (let i = 0; i < count; i++) {
        const dur = tf & 0x100 ? u32(u8, (q += 4) - 4) : duration;
        const n = tf & 0x200 ? u32(u8, (q += 4) - 4) : size;
        if (tf & 0x400) q += 4;
        const cto = tf & 0x800 ? (version === 1 ? s32(u8, q) : u32(u8, q)) : 0;
        if (tf & 0x800) q += 4;
        need(n > 0, 'sample without a size');
        if (track) samples.push({ track: id, pos: data, size: n, fileRel, timeMs: ((time + cto) / track.timescale) * 1000 });
        data += n;
        time += dur;
      }
    }
    if (track) track.nextTime = time;
    return { end: data, fileRel, first };
  }

  function onMoof(u8, from, to, at) {
    const samples = [];
    let implicit = at;
    let minFile = Infinity;
    for (const [type, a, b] of kids(u8, from, to)) {
      if (type !== 'traf') continue;
      const r = readTraf(u8, a, b, at, implicit, samples);
      implicit = r.end;
      if (r.fileRel && r.first !== null) minFile = Math.min(minFile, r.first);
    }
    moof = samples.length ? { samples, minFile } : null;
  }

  function onMdat(u8, head, at) {
    const m = moof;
    moof = null;
    const start = at + head;
    const end = at + u8.length;
    const inside = (p, n) => p >= start && p + n <= end;
    // File offsets mean nothing mid-stream: then the data is taken to start the mdat.
    const shift = m.samples.some((s) => s.fileRel && !inside(s.pos, s.size)) ? start - m.minFile : 0;
    let bad = 0;
    for (const s of m.samples) {
      const p = s.pos + (s.fileRel ? shift : 0);
      if (!inside(p, s.size)) {
        bad++;
        continue;
      }
      out.push({ type: 'block', track: s.track, timeMs: s.timeMs, data: u8.slice(p - at, p - at + s.size), keyframe: true });
    }
    if (bad) report(`${bad} samples outside their mdat`);
    else errored = false;
  }

  function parse() {
    for (;;) {
      if (resync && !findSync()) return;
      if (skip) {
        const n = Math.min(skip, buf.length - off);
        off += n;
        skip -= n;
        if (skip) return;
      }
      const h = readHeader();
      if (!h) return;
      if (h.bad) {
        fail(h.bad);
        continue;
      }
      const whole = h.type === 'moov' || h.type === 'moof' || (h.type === 'mdat' && moof);
      if (whole) {
        if (h.size > maxBoxBytes) {
          fail(`${h.type} too large`);
          continue;
        }
        if (buf.length - off < h.size) return;
        const at = pos();
        const box = buf.subarray(off, off + h.size);
        off += h.size;
        try {
          if (h.type === 'moov') onMoov(box, h.head, box.length);
          else if (h.type === 'moof') onMoof(box, h.head, box.length, at);
          else onMdat(box, h.head, at);
        } catch (e) {
          moof = null;
          report(e.message);
        }
        continue;
      }
      if (!SKIP.has(h.type) && h.size > maxUnknownBytes) {
        fail(`unknown large box ${h.type}`);
        continue;
      }
      off += h.head;
      skip = h.size - h.head;
    }
  }

  return {
    // Accepts Uint8Array or ArrayBuffer; the bytes are copied.
    push(chunk) {
      out = [];
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const left = buf.length - off;
      const next = new Uint8Array(left + bytes.length);
      next.set(buf.subarray(off));
      next.set(bytes, left);
      base += off;
      off = 0;
      buf = next;
      parse();
      if (off >= buf.length) {
        base += off;
        off = 0;
        buf = EMPTY;
      }
      return out;
    },
    // End of stream: resets, dropping a truncated tail (a moof without its mdat).
    flush() {
      buf = EMPTY;
      off = 0;
      base = 0;
      skip = 0;
      resync = false;
      errored = false;
      tracks = new Map();
      defaults = new Map();
      moof = null;
      return [];
    },
  };
}
