// The page-world ⇄ isolated-world bridge: envelope tags, size limits and the
// sanitizer the isolated side runs on everything the page world sends (a page
// script can pose as the page world, so nothing is trusted as is).
//
// isolated ──window.postMessage({ tc: 'hello', nonce }, [port])──▶ page world
// page world ──port { tc: 'ev', nonce, ev }──▶ isolated (events, replies)
// isolated ──port { tc: 'cmd', nonce, id, cmd, args }──▶ page world

export const TC_HELLO = 'hello';
export const TC_EVENT = 'ev';
export const TC_COMMAND = 'cmd';

export const LIMITS = {
  subtitleBytes: 2 * 1024 * 1024,
  subtitleQueue: 64, // responses held before the handshake
  ringBytes: 8 * 1024 * 1024, // media bytes held per audio stream while not forwarding
  initQueue: 32,
  eventQueue: 512, // small events held before the handshake
  chunkBytes: 4 * 1024 * 1024, // one append; bigger ones are counted, not copied
  urlChars: 8192,
  mimeChars: 256,
};

export const MSE_OPS = ['abort', 'remove', 'changeType', 'timestampOffset', 'removed'];
const HOOK_STATES = ['ok', 'failed', 'absent'];
const EME_VIA = ['request', 'setMediaKeys', 'encrypted'];

const AUDIO_CODEC = /^(opus|vorbis|mp4a|flac|ac-3|ec-3|mp3|alac)/;
// AAC-LC, HE-AAC v1 and v2.
const AAC = /^mp4a\.40\.0*(2|5|29)$/;

// What a SourceBuffer mime carries and whether the media pipeline can take it
// (WebM with Opus, MP4 with AAC, or either without a codecs parameter).
export function classifyMime(mime) {
  const m = String(mime || '').toLowerCase();
  const type = m.split(';')[0].trim();
  const codecs = (/codecs\s*=\s*"?([^";]*)"?/.exec(m)?.[1] || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const audio = type.startsWith('audio/') || (codecs.length > 0 && codecs.every((c) => AUDIO_CODEC.test(c)));
  const kind = audio ? 'audio' : type.startsWith('video/') ? 'video' : 'other';
  const container = type.split('/')[1] || '';
  const codec = codecs[0] || '';
  const forward =
    kind === 'audio' && ((container === 'webm' && (codec === '' || codec === 'opus')) || (container === 'mp4' && (codec === '' || AAC.test(codec))));
  return { kind, container, codec, forward };
}

// An append that starts with a WebM EBML header or an MP4 ftyp (or bare moov) box.
export function isInitSegment(u8) {
  if (!u8 || u8.length < 8) return false;
  if (u8[0] === 0x1a && u8[1] === 0x45 && u8[2] === 0xdf && u8[3] === 0xa3) return true;
  const type = String.fromCharCode(u8[4], u8[5], u8[6], u8[7]);
  return type === 'ftyp' || type === 'moov';
}

const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : undefined);
const id = (v) => (Number.isSafeInteger(v) && v > 0 ? v : undefined);
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : undefined);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const oneOf = (v, list) => (list.includes(v) ? v : undefined);
const drop = (o) => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

// Small JSON-able values only (command results), or undefined.
function plain(v, maxChars = 16384) {
  try {
    const s = JSON.stringify(v);
    return s !== undefined && s.length <= maxChars ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}

// A clean copy of a page-world event, or null when it is not one we know.
export function sanitizeMainEvent(ev) {
  if (!ev || typeof ev !== 'object' || typeof ev.k !== 'string') return null;
  switch (ev.k) {
    case 'welcome':
      return { k: 'welcome' };
    case 'hooks': {
      const s = ev.status && typeof ev.status === 'object' ? ev.status : {};
      const status = {};
      for (const name of ['fetch', 'xhr', 'mse', 'objectUrl', 'eme']) status[name] = oneOf(s[name], HOOK_STATES) || 'failed';
      return { k: 'hooks', status };
    }
    case 'subtitle': {
      const url = str(ev.url, LIMITS.urlChars);
      const text = str(ev.text, LIMITS.subtitleBytes);
      if (!url || text === undefined) return null;
      return drop({
        k: 'subtitle',
        via: oneOf(ev.via, ['fetch', 'xhr']) || 'fetch',
        url,
        status: Number.isSafeInteger(ev.status) && ev.status >= 0 && ev.status < 1000 ? ev.status : 0,
        contentType: str(ev.contentType, LIMITS.mimeChars) || '',
        text,
      });
    }
    case 'mse-source': {
      const msId = id(ev.msId);
      const url = str(ev.url, 512);
      return msId && url && url.startsWith('blob:') ? { k: 'mse-source', msId, url } : null;
    }
    case 'mse-buffer': {
      const sbId = id(ev.sbId);
      const msId = id(ev.msId);
      const mime = str(ev.mime, LIMITS.mimeChars);
      return sbId && msId && mime !== undefined ? { k: 'mse-buffer', sbId, msId, mime } : null;
    }
    case 'mse-chunk': {
      const sbId = id(ev.sbId);
      const seq = count(ev.seq);
      const size = count(ev.size);
      if (!sbId || seq === undefined || size === undefined) return null;
      let bytes = null;
      if (ev.bytes instanceof ArrayBuffer) {
        if (ev.bytes.byteLength > LIMITS.chunkBytes || ev.bytes.byteLength !== size) return null;
        bytes = ev.bytes;
      }
      return { k: 'mse-chunk', sbId, seq, init: ev.init === true, size, bytes };
    }
    case 'mse-op': {
      const sbId = id(ev.sbId);
      const op = oneOf(ev.op, MSE_OPS);
      if (!sbId || !op) return null;
      return drop({ k: 'mse-op', sbId, op, mime: str(ev.mime, LIMITS.mimeChars), start: num(ev.start), end: num(ev.end), value: num(ev.value) });
    }
    case 'mse-closed': {
      const msId = id(ev.msId);
      return msId ? { k: 'mse-closed', msId } : null;
    }
    case 'eme': {
      const via = oneOf(ev.via, EME_VIA);
      if (!via) return null;
      return drop({ k: 'eme', via, keySystem: str(ev.keySystem, 128), initDataType: str(ev.initDataType, 32), on: typeof ev.on === 'boolean' ? ev.on : undefined });
    }
    case 'dropped':
      return { k: 'dropped', chunks: count(ev.chunks) || 0, bytes: count(ev.bytes) || 0, subtitles: count(ev.subtitles) || 0, events: count(ev.events) || 0 };
    case 'reply': {
      const rid = id(ev.id);
      if (!rid) return null;
      return drop({ k: 'reply', id: rid, ok: ev.ok === true, result: plain(ev.result), error: str(ev.error, 200) });
    }
    default:
      return null;
  }
}
