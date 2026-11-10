// Streaming WebM demuxer for the audio track: bytes cut anywhere in, track
// and block events out (to decode.js). Handles the unknown-size Segment and
// Cluster of MSE streams, the three lacing kinds, skips everything else by
// size, and after bad data reports once and resyncs on the next Cluster or
// EBML header. Plain JS so it runs under Node for tests.

const ID = {
  EBML: 0x1a45dfa3,
  SEGMENT: 0x18538067,
  SEEK_HEAD: 0x114d9b74,
  INFO: 0x1549a966,
  TIMECODE_SCALE: 0x2ad7b1,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  TRACK_NUMBER: 0xd7,
  CODEC_ID: 0x86,
  CODEC_PRIVATE: 0x63a2,
  DEFAULT_DURATION: 0x23e383,
  AUDIO: 0xe1,
  SAMPLING_FREQUENCY: 0xb5,
  CHANNELS: 0x9f,
  CLUSTER: 0x1f43b675,
  TIMECODE: 0xe7,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
  REFERENCE_BLOCK: 0xfb,
  CUES: 0x1c53bb6b,
  ATTACHMENTS: 0x1941a469,
  CHAPTERS: 0x1043a770,
  TAGS: 0x1254c367,
};

const MASTERS = new Set([ID.SEGMENT, ID.INFO, ID.TRACKS, ID.TRACK_ENTRY, ID.AUDIO, ID.CLUSTER, ID.BLOCK_GROUP]);
const LEAVES = new Set([
  ID.TIMECODE_SCALE, ID.TRACK_NUMBER, ID.CODEC_ID, ID.CODEC_PRIVATE, ID.DEFAULT_DURATION,
  ID.SAMPLING_FREQUENCY, ID.CHANNELS, ID.TIMECODE, ID.SIMPLE_BLOCK, ID.BLOCK, ID.REFERENCE_BLOCK,
]);
// An unknown-size element ends where an element of its own level or above starts.
const LEVEL = new Map([
  [ID.EBML, 0], [ID.SEGMENT, 0],
  [ID.SEEK_HEAD, 1], [ID.INFO, 1], [ID.TRACKS, 1], [ID.CLUSTER, 1], [ID.CUES, 1], [ID.ATTACHMENTS, 1], [ID.CHAPTERS, 1], [ID.TAGS, 1],
  [ID.TRACK_ENTRY, 2], [ID.TIMECODE, 2], [ID.SIMPLE_BLOCK, 2], [ID.BLOCK_GROUP, 2],
]);
const TOP_LEVEL = new Set([...LEVEL].filter(([, l]) => l <= 1).map(([id]) => id));
const UNKNOWN = -1;
const EMPTY = new Uint8Array(0);

const isAudioCodec = (c) => c === 'A_OPUS' || c.startsWith('A_AAC');

// Length of a vint from its first byte (1..8), 0 when invalid.
function vintLength(b) {
  for (let i = 0; i < 8; i++) if (b & (0x80 >> i)) return i + 1;
  return 0;
}

// A size-style vint (marker stripped): { value, len } or null.
function readVint(data, p) {
  if (p >= data.length) return null;
  const len = vintLength(data[p]);
  if (!len || p + len > data.length) return null;
  let value = data[p] & (0xff >> len);
  for (let i = 1; i < len; i++) value = value * 256 + data[p + i];
  return { value, len };
}

function readUint(data) {
  let v = 0;
  for (const b of data) v = v * 256 + b;
  return v;
}

function readFloat(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length === 4) return view.getFloat32(0);
  if (data.length === 8) return view.getFloat64(0);
  return 0;
}

const ascii = (data) => String.fromCharCode(...data).replace(/\0+$/, '');

// Duration of one Opus packet from its TOC byte (RFC 6716 §3.1).
export function opusPacketMs(p) {
  if (!p.length) return 0;
  const config = p[0] >> 3;
  const frameMs = config < 12 ? [10, 20, 40, 60][config & 3] : config < 16 ? [10, 20][config & 1] : [2.5, 5, 10, 20][config & 3];
  const code = p[0] & 3;
  const frames = code === 0 ? 1 : code < 3 ? 2 : p.length > 1 ? p[1] & 0x3f : 0;
  return frameMs * frames;
}

// Frame [start, end) offsets of a laced block payload from p (the lace-count
// byte), or null when the sizes do not add up.
function splitLaces(data, p, lacing) {
  if (p >= data.length) return null;
  const count = data[p++] + 1;
  const sizes = [];
  if (lacing === 1) {
    for (let i = 0; i < count - 1; i++) {
      let size = 0;
      let b;
      do {
        if (p >= data.length) return null;
        b = data[p++];
        size += b;
      } while (b === 255);
      sizes.push(size);
    }
  } else if (lacing === 3) {
    if (count > 1) {
      let r = readVint(data, p);
      if (!r) return null;
      p += r.len;
      let size = r.value;
      sizes.push(size);
      for (let i = 1; i < count - 1; i++) {
        r = readVint(data, p);
        if (!r) return null;
        p += r.len;
        size += r.value - (2 ** (7 * r.len - 1) - 1);
        if (size < 0) return null;
        sizes.push(size);
      }
    }
  } else {
    const total = data.length - p;
    if (total % count) return null;
    for (let i = 0; i < count - 1; i++) sizes.push(total / count);
  }
  const last = data.length - p - sizes.reduce((a, b) => a + b, 0);
  if (last < 0) return null;
  sizes.push(last);
  const frames = [];
  for (const size of sizes) {
    frames.push([p, p + size]);
    p += size;
  }
  return frames;
}

export function createWebmDemuxer({ maxElementBytes = 16 * 1024 * 1024 } = {}) {
  let buf = EMPTY;
  let off = 0; // read position in buf
  let base = 0; // stream offset of buf[0]
  let stack = []; // open masters: { id, end } (end Infinity when unknown)
  let skip = 0; // bytes of a skipped element still to come
  let resync = false;
  let errored = false; // one error event per bad stretch
  let scale = 1e6; // TimecodeScale, ns per tick
  let clusterTime = 0;
  let entry = null; // TrackEntry being read
  let tracks = new Map();
  let out = [];

  const pos = () => base + off;

  function report(message) {
    if (!errored) out.push({ type: 'error', message });
    errored = true;
  }

  function fail(message) {
    report(message);
    resync = true;
    stack = [];
    skip = 0;
    entry = null;
    off += 1; // never resync onto the element that just failed
  }

  // Next Cluster or EBML header at or after off; keeps a 3-byte tail so an id split across pushes is found.
  function findSync() {
    for (let i = off; i + 4 <= buf.length; i++) {
      const b = buf[i];
      if ((b === 0x1f && buf[i + 1] === 0x43 && buf[i + 2] === 0xb6 && buf[i + 3] === 0x75) || (b === 0x1a && buf[i + 1] === 0x45 && buf[i + 2] === 0xdf && buf[i + 3] === 0xa3)) {
        off = i;
        resync = false;
        return true;
      }
    }
    off = Math.max(off, buf.length - 3);
    return false;
  }

  // { id, size, len }, null when more bytes are needed, { bad } when invalid.
  function readHeader() {
    const avail = buf.length - off;
    if (avail < 1) return null;
    const idLen = vintLength(buf[off]);
    if (!idLen || idLen > 4) return { bad: 'bad element id' };
    if (avail < idLen + 1) return null;
    let id = 0;
    for (let i = 0; i < idLen; i++) id = id * 256 + buf[off + i];
    const sLen = vintLength(buf[off + idLen]);
    if (!sLen) return { bad: 'bad element size' };
    if (avail < idLen + sLen) return null;
    const mask = 0xff >> sLen;
    let size = buf[off + idLen] & mask;
    let allOnes = size === mask;
    for (let i = 1; i < sLen; i++) {
      const b = buf[off + idLen + i];
      size = size * 256 + b;
      if (b !== 0xff) allOnes = false;
    }
    return { id, size: allOnes ? UNKNOWN : size, len: idLen + sLen };
  }

  function openMaster(id, end) {
    const c = { id, end };
    if (id === ID.TRACK_ENTRY) entry = { number: 0, codec: '', codecPrivate: null, channels: 1, sampleRate: 8000, defaultDurationNs: 0 };
    if (id === ID.CLUSTER) clusterTime = 0;
    if (id === ID.BLOCK_GROUP) Object.assign(c, { frames: null, ref: false });
    stack.push(c);
  }

  function pop() {
    const c = stack.pop();
    if (c.id === ID.TRACK_ENTRY && entry) {
      if (entry.number && isAudioCodec(entry.codec)) {
        const { number, codec, channels, sampleRate, codecPrivate } = entry;
        tracks.set(number, entry);
        out.push({ type: 'track', number, codec, channels, sampleRate, codecPrivate });
        errored = false;
      }
      entry = null;
    }
    if (c.id === ID.BLOCK_GROUP && c.frames) emitFrames(c.frames, !c.ref);
  }

  // Closes every master whose end has been reached, with whatever sits above it.
  function closeEnded() {
    const p = pos();
    const i = stack.findIndex((c) => c.end <= p);
    if (i < 0) return;
    while (stack.length > i) pop();
  }

  // An element of level L ends every open master of level L or deeper: the
  // end of an unknown-size one, or a cut-short append in an MSE stream.
  function closeByLevel(id) {
    const level = LEVEL.get(id);
    if (level === undefined) return;
    const i = stack.findIndex((c) => (LEVEL.get(c.id) ?? -1) >= level);
    if (i < 0) return;
    while (stack.length > i) pop();
  }

  // Track number of a (Simple)Block whose payload starts at p, if readable yet.
  function blockTrack(p) {
    const r = readVint(buf, p);
    return r && p + r.len <= buf.length ? r.value : null;
  }

  // { track, frames: [{ timeMs, data }], key } or null for other tracks; throws on bad payloads.
  function parseBlock(data, simple) {
    const tn = readVint(data, 0);
    if (!tn || data.length < tn.len + 3) throw new Error('short block');
    const track = tracks.get(tn.value);
    if (!track) return null;
    const p = tn.len;
    const rel = ((data[p] << 8) | data[p + 1]) << 16 >> 16;
    const flags = data[p + 2];
    const lacing = (flags >> 1) & 3;
    const spans = lacing ? splitLaces(data, p + 3, lacing) : [[p + 3, data.length]];
    if (!spans) throw new Error('bad lacing');
    const t0 = ((clusterTime + rel) * scale) / 1e6;
    let at = 0;
    const frames = spans.map(([a, b], i) => {
      const frame = data.slice(a, b);
      const timeMs = track.codec === 'A_OPUS' ? t0 + at : t0 + (i * track.defaultDurationNs) / 1e6;
      if (track.codec === 'A_OPUS') at += opusPacketMs(frame);
      return { timeMs, data: frame };
    });
    return { track: track.number, frames, key: simple ? !!(flags & 0x80) : true };
  }

  function emitFrames(block, keyframe) {
    for (const f of block.frames) out.push({ type: 'block', track: block.track, timeMs: f.timeMs, data: f.data, keyframe });
    if (block.frames.length) errored = false;
  }

  function leaf(id, data, parent) {
    switch (id) {
      case ID.TIMECODE_SCALE:
        scale = readUint(data) || 1e6;
        break;
      case ID.TRACK_NUMBER:
        if (entry) entry.number = readUint(data);
        break;
      case ID.CODEC_ID:
        if (entry) entry.codec = ascii(data);
        break;
      case ID.CODEC_PRIVATE:
        if (entry) entry.codecPrivate = data.slice();
        break;
      case ID.DEFAULT_DURATION:
        if (entry) entry.defaultDurationNs = readUint(data);
        break;
      case ID.SAMPLING_FREQUENCY:
        if (entry) entry.sampleRate = readFloat(data) || entry.sampleRate;
        break;
      case ID.CHANNELS:
        if (entry) entry.channels = readUint(data) || 1;
        break;
      case ID.TIMECODE:
        clusterTime = readUint(data);
        break;
      case ID.REFERENCE_BLOCK:
        if (parent?.id === ID.BLOCK_GROUP) parent.ref = true;
        break;
      case ID.SIMPLE_BLOCK:
      case ID.BLOCK: {
        let block;
        try {
          block = parseBlock(data, id === ID.SIMPLE_BLOCK);
        } catch (e) {
          report(e.message);
          return;
        }
        if (!block) return;
        if (id === ID.BLOCK && parent?.id === ID.BLOCK_GROUP) parent.frames = block;
        else emitFrames(block, block.key);
        break;
      }
      default:
    }
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
      closeEnded();
      const h = readHeader();
      if (!h) return;
      if (h.bad) {
        fail(h.bad);
        continue;
      }
      closeByLevel(h.id);
      const parent = stack[stack.length - 1];
      const end = h.size === UNKNOWN ? Infinity : pos() + h.len + h.size;
      if (parent ? end > parent.end : !TOP_LEVEL.has(h.id)) {
        fail(parent ? 'element overruns its parent' : 'unexpected top-level element');
        continue;
      }
      if (MASTERS.has(h.id)) {
        off += h.len;
        openMaster(h.id, end);
        continue;
      }
      if (h.size === UNKNOWN) {
        fail('unknown-size element that cannot be skipped');
        continue;
      }
      const isBlock = h.id === ID.SIMPLE_BLOCK || h.id === ID.BLOCK;
      if (LEAVES.has(h.id)) {
        // Other tracks' blocks (video) are skipped without being buffered.
        const track = isBlock ? blockTrack(off + h.len) : null;
        if (!isBlock || track === null || tracks.has(track)) {
          if (h.size > maxElementBytes) {
            fail('element too large');
            continue;
          }
          if (buf.length - off < h.len + h.size) return;
          const data = buf.subarray(off + h.len, off + h.len + h.size);
          off += h.len + h.size;
          leaf(h.id, data, parent);
          continue;
        }
      }
      // Only a known-size parent vouches for a big skip; elsewhere it is garbage.
      if (!isBlock && h.size > maxElementBytes && !(parent && parent.end !== Infinity)) {
        fail('element too large');
        continue;
      }
      off += h.len;
      skip = h.size;
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
    // End of stream: closes what is open (a pending BlockGroup is emitted)
    // and resets, dropping a truncated tail.
    flush() {
      out = [];
      if (!resync) {
        off = buf.length;
        while (stack.length) pop();
      }
      buf = EMPTY;
      off = 0;
      base = 0;
      stack = [];
      skip = 0;
      resync = false;
      errored = false;
      scale = 1e6;
      clusterTime = 0;
      entry = null;
      tracks = new Map();
      return out;
    },
  };
}
