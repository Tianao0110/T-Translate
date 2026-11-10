// What content scripts tell the service worker about their page (PAGE_EVENT)
// and what the worker can ask of them (PAGE_COMMAND). The worker runs
// checkPageEvent on every PAGE_EVENT: a content script lives in a renderer
// that also runs the site, so its messages are size- and shape-checked.

export const PAGE_EVENT_MAX_CHARS = 256 * 1024; // one PAGE_EVENT; subtitle cues are split to fit
export const MAX_CUES_PER_PART = 5000;

export const PAGE_COMMANDS = ['mse-capture', 'cues', 'display', 'mode', 'site-captions', 'notice', 'yt-reload', 'yt-captions-on', 'query', 'reset'];
// listen: tier 3 (accept or dismiss); permission: the video's host is not allowed yet (dismiss only).
export const NOTICE_KINDS = ['listen', 'permission'];

const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : undefined);
const optStr = (v, max) => (v === null || v === undefined ? null : str(v, max) ?? null);
const int = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : undefined);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v) => v === true;
const HOOK_STATES = ['ok', 'failed', 'absent', 'missing'];

function cue(c) {
  if (!c || typeof c !== 'object') return null;
  const id = typeof c.id === 'number' ? String(c.id) : str(c.id, 64);
  const start = num(c.start);
  const end = num(c.end);
  const text = str(c.text, 4000);
  return id !== undefined && start !== null && end !== null && text !== undefined ? { id, start, end, text } : null;
}

export const sanitizeCue = cue;

function media(m) {
  if (!m || typeof m !== 'object' || !int(m.elId)) return null;
  return {
    elId: m.elId,
    tag: m.tag === 'audio' ? 'audio' : 'video',
    src: str(m.src, 2048) ?? '',
    msId: int(m.msId) ?? null,
    state: ['playing', 'paused', 'ended', 'seeking', 'idle'].includes(m.state) ? m.state : 'idle',
    currentTime: num(m.currentTime) ?? 0,
    duration: num(m.duration),
    live: bool(m.live),
    muted: bool(m.muted),
    volume: num(m.volume) ?? 1,
    readyState: int(m.readyState) ?? 0,
    width: int(m.width) ?? 0,
    height: int(m.height) ?? 0,
    videoWidth: int(m.videoWidth) ?? 0,
    videoHeight: int(m.videoHeight) ?? 0,
    visible: bool(m.visible),
    pageVisible: bool(m.pageVisible),
    bufferedEndS: num(m.bufferedEndS),
    encrypted: bool(m.encrypted),
    siteTracks: int(m.siteTracks) ?? 0,
  };
}

function stream(s) {
  if (!s || typeof s !== 'object' || !int(s.streamId)) return null;
  const op = s.lastOp && typeof s.lastOp === 'object' ? { op: str(s.lastOp.op, 32) ?? '', at: num(s.lastOp.at) } : null;
  return {
    streamId: s.streamId,
    msId: int(s.msId) ?? null,
    url: optStr(s.url, 512),
    mime: str(s.mime, 256) ?? '',
    kind: ['audio', 'video', 'other'].includes(s.kind) ? s.kind : 'other',
    codec: str(s.codec, 64) ?? '',
    forward: bool(s.forward),
    alive: bool(s.alive),
    init: bool(s.init),
    inits: int(s.inits) ?? 0,
    chunks: int(s.chunks) ?? 0,
    bytes: int(s.bytes) ?? 0,
    firstTimeS: num(s.firstTimeS),
    lastTimeS: num(s.lastTimeS),
    lastOp: op,
    held: int(s.held) ?? 0,
  };
}

function event(e) {
  if (!e || typeof e !== 'object') return null;
  switch (e.type) {
    case 'navigated': {
      const url = str(e.url, 8192);
      return url && int(e.navSeq) !== undefined ? { type: 'navigated', url, mediaId: optStr(e.mediaId, 128), navSeq: e.navSeq, site: str(e.site, 32) ?? 'generic', resync: bool(e.resync) } : null;
    }
    case 'hooks': {
      const h = e.hooks && typeof e.hooks === 'object' ? e.hooks : {};
      const hooks = {};
      for (const k of ['main', 'fetch', 'xhr', 'mse', 'objectUrl', 'eme']) if (HOOK_STATES.includes(h[k])) hooks[k] = h[k];
      const d = h.dropped && typeof h.dropped === 'object' ? h.dropped : null;
      if (d) hooks.dropped = { chunks: int(d.chunks) ?? 0, bytes: int(d.bytes) ?? 0, subtitles: int(d.subtitles) ?? 0, events: int(d.events) ?? 0 };
      return { type: 'hooks', hooks };
    }
    case 'media': {
      const m = media(e.media);
      return m ? { type: 'media', reason: str(e.reason, 32) ?? '', media: m, primary: bool(e.primary) } : null;
    }
    case 'media-removed':
      return int(e.elId) ? { type: 'media-removed', elId: e.elId } : null;
    case 'media-id':
      return { type: 'media-id', mediaId: optStr(e.mediaId, 128) };
    case 'subtitle-parsed': {
      const url = str(e.url, 8192);
      const part = int(e.part);
      const parts = int(e.parts);
      if (!url || !int(e.subId) || part === undefined || !parts || part >= parts || parts > 256 || !Array.isArray(e.cues) || e.cues.length > MAX_CUES_PER_PART) return null;
      const cues = e.cues.map(cue);
      if (cues.includes(null)) return null;
      return {
        type: 'subtitle-parsed',
        subId: e.subId,
        url,
        via: ['xhr', 'track'].includes(e.via) ? e.via : 'fetch',
        status: int(e.status) ?? 0,
        format: ['vtt', 'srt', 'ttml', 'json3', 'bcc'].includes(e.format) ? e.format : null,
        lang: str(e.lang, 32) ?? '',
        kind: str(e.kind, 16) ?? '',
        mediaId: optStr(e.mediaId, 128),
        cueCount: int(e.cueCount) ?? 0,
        part,
        parts,
        cues,
      };
    }
    case 'mse-stream': {
      const s = stream(e.stream);
      return s ? { type: 'mse-stream', stream: s, main: bool(e.main) } : null;
    }
    case 'eme':
      return { type: 'eme', via: ['request', 'setMediaKeys', 'encrypted'].includes(e.via) ? e.via : 'request', keySystem: optStr(e.keySystem, 128), initDataType: optStr(e.initDataType, 32), on: typeof e.on === 'boolean' ? e.on : null };
    case 'capture':
      return { type: 'capture', on: bool(e.on), streamId: int(e.streamId) ?? null, reason: str(e.reason, 32) ?? '', pushes: int(e.pushes) ?? 0, bytes: int(e.bytes) ?? 0 };
    case 'notice-action':
      return NOTICE_KINDS.includes(e.kind) && (e.action === 'dismiss' || (e.action === 'accept' && e.kind === 'listen')) ? { type: 'notice-action', kind: e.kind, action: e.action } : null;
    default:
      return null;
  }
}

// { docId, navSeq, event } with a known, well-formed event, or null.
export function checkPageEvent(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const docId = str(payload.docId, 64);
  const navSeq = int(payload.navSeq);
  const ev = event(payload.event);
  return docId && navSeq !== undefined && ev ? { docId, navSeq, event: ev } : null;
}

// PAGE_MEDIA payload checks; the bytes themselves are checked where decoded.
export function checkPageMedia(p) {
  if (!p || typeof p !== 'object' || !int(p.streamId) || int(p.seq) === undefined || typeof p.bytes !== 'string') return null;
  return { streamId: p.streamId, seq: p.seq, init: bool(p.init), timeS: num(p.timeS), bytes: p.bytes };
}
