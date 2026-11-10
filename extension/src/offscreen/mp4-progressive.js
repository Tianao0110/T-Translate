// Progressive-MP4 demuxer for files the service worker fetches by range
// (sw/direct-fetch.js): first the bytes holding the moov (ftyp + moov, or the
// moov alone from the end of the file), then mdat bytes from any start, each
// push with its file offset. The moov's sample table says where every audio
// sample sits; samples wholly inside the bytes so far come out as the same
// track / block events as mp4-demux.js, a sample cut by a push waits for the
// next one. A push that does not continue the last starts over there (a
// seek); bytes opening with ftyp or moov are a new file's head. Bad data is
// reported once. Plain JS so it runs under Node for tests.

import { parseMoov, indexAtOffset, topBoxes, type4, u32 } from '../shared/mp4-table.js';

const EMPTY = new Uint8Array(0);
const MAX_SAMPLE_BYTES = 1024 * 1024;

function concat(a, b) {
  if (!a.length) return b.slice();
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

// Bytes that open with an ftyp or moov box header.
function opensHead(u8) {
  if (u8.length < 8) return false;
  const type = type4(u8, 4);
  const size = u32(u8, 0);
  return (type === 'ftyp' || type === 'moov') && (size === 1 || size >= 8);
}

// 'moov' once the head holds a whole moov, 'wait' for more bytes, 'bad'.
function headState(u8) {
  const boxes = topBoxes(u8);
  const moov = boxes.find((b) => b.type === 'moov');
  if (moov) return moov.offset + moov.size <= u8.length ? 'moov' : 'wait';
  const last = boxes[boxes.length - 1];
  const covered = last ? last.offset + last.size : 0;
  return covered + 8 <= u8.length ? 'bad' : 'wait';
}

export function createProgressiveMp4Demuxer({ maxHeadBytes = 64 * 1024 * 1024 } = {}) {
  let table = null;
  let head = null; // { start, bytes } while the moov is being collected
  let buf = EMPTY; // mdat bytes from bufStart on, contiguous
  let bufStart = 0;
  let next = 0; // the next sample to cut
  let errored = false;
  let out = [];

  function report(message) {
    if (!errored) out.push({ type: 'error', message });
    errored = true;
  }

  // Every sample wholly inside buf; buf keeps only the bytes from the next sample on.
  function cut() {
    const s = table.samples;
    const end = bufStart + buf.length;
    while (next < s.length && s[next].offset < bufStart) next++;
    while (next < s.length && s[next].offset + s[next].size <= end) {
      const x = s[next++];
      if (x.size > MAX_SAMPLE_BYTES) {
        report(`sample of ${x.size} bytes`);
        continue;
      }
      const at = x.offset - bufStart;
      out.push({ type: 'block', track: table.track.number, timeMs: x.timeMs, data: buf.slice(at, at + x.size), keyframe: true });
    }
    if (next < s.length && s[next].size > MAX_SAMPLE_BYTES && s[next].offset < end) {
      report(`sample of ${s[next].size} bytes`);
      next++;
    }
    const keep = next < s.length ? Math.min(Math.max(s[next].offset, bufStart), end) : end;
    buf = keep === end ? EMPTY : buf.slice(keep - bufStart);
    bufStart = keep;
  }

  function onHead() {
    const state = headState(head.bytes);
    if (state === 'wait') {
      if (head.bytes.length > maxHeadBytes) {
        head = null;
        report('no moov in the head');
      }
      return;
    }
    const { start, bytes } = head;
    head = null;
    if (state === 'bad') return report('bad box in the head');
    let t;
    try {
      t = parseMoov(bytes, { base: start });
    } catch (e) {
      return report(e.message);
    }
    table = t;
    errored = false;
    const { number, codec, channels, sampleRate, codecPrivate } = t.track;
    out.push({ type: 'track', number, codec, channels, sampleRate, codecPrivate });
    // A whole file pushed at once already holds its samples.
    buf = bytes;
    bufStart = start;
    next = indexAtOffset(table, start);
    cut();
  }

  return {
    // bytes: Uint8Array or ArrayBuffer (copied); offset: their file offset,
    // or right after the last push when left out.
    push(chunk, { offset } = {}) {
      out = [];
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const end = head ? head.start + head.bytes.length : bufStart + buf.length;
      const at = Number.isSafeInteger(offset) && offset >= 0 ? offset : end;
      if (!bytes.length) return out;
      if (head && at === end) {
        head.bytes = concat(head.bytes, bytes);
        onHead();
      } else if (opensHead(bytes)) {
        head = { start: at, bytes: bytes.slice() };
        buf = EMPTY;
        onHead();
      } else if (!table) {
        head = null;
        report('mdat bytes before the moov');
      } else {
        if (at === end) buf = concat(buf, bytes);
        else {
          head = null;
          buf = bytes.slice();
          bufStart = at;
          next = indexAtOffset(table, at);
        }
        cut();
      }
      return out;
    },
    // End of stream: resets, dropping a sample cut short.
    flush() {
      table = null;
      head = null;
      buf = EMPTY;
      bufStart = 0;
      next = 0;
      errored = false;
      return [];
    },
  };
}
