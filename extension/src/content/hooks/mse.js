// Page world: Media Source Extensions. Notes each MediaSource (and its blob
// URL, so the isolated world can match it to a <video src>), each
// SourceBuffer's mime, and copies the bytes of audio appends the media
// pipeline can decode (WebM / Opus); other audio appends are only counted.
// Video bytes are never copied.

import { hookMethod, hookSetter, tryHook } from './patch.js';
import { LIMITS, classifyMime, isInitSegment } from '../bridge-protocol.js';

function bytesOf(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

export function installMseHooks(win, { emit, maxChunk = LIMITS.chunkBytes }) {
  const MS = win.MediaSource;
  const SB = win.SourceBuffer;
  if (!MS || !SB) return { mse: 'absent', objectUrl: 'absent' };

  const sources = new WeakMap(); // MediaSource → msId
  const buffers = new WeakMap(); // SourceBuffer → { sbId, mime, kind, forward, seq }
  let nextMs = 0;
  let nextSb = 0;

  function msIdOf(ms) {
    let msId = sources.get(ms);
    if (!msId) {
      msId = ++nextMs;
      sources.set(ms, msId);
      ms.addEventListener('sourceclose', () => emit({ k: 'mse-closed', msId }));
    }
    return msId;
  }

  function onAppend(sb, data) {
    const info = buffers.get(sb);
    if (!info || info.kind !== 'audio') return;
    const u8 = bytesOf(data);
    if (!u8) return;
    const seq = info.seq++;
    const init = isInitSegment(u8);
    // The append already copied the data; ours is a second copy for the pipeline.
    const bytes = info.forward && u8.byteLength <= maxChunk ? u8.slice().buffer : null;
    emit({ k: 'mse-chunk', sbId: info.sbId, seq, init, size: u8.byteLength, bytes });
  }

  const op = (sb, name, extra = {}) => {
    const info = buffers.get(sb);
    if (info) emit({ k: 'mse-op', sbId: info.sbId, op: name, ...extra });
  };

  const mse = tryHook(() => {
    const MSp = MS.prototype;
    const SBp = SB.prototype;
    const added = hookMethod(MSp, 'addSourceBuffer', (sb, self, args) => {
      if (!sb) return;
      const mime = String(args[0] ?? '').slice(0, LIMITS.mimeChars);
      const { kind, forward } = classifyMime(mime);
      const info = { sbId: ++nextSb, mime, kind, forward, seq: 0 };
      buffers.set(sb, info);
      emit({ k: 'mse-buffer', sbId: info.sbId, msId: msIdOf(self), mime });
    });
    hookMethod(MSp, 'removeSourceBuffer', (_r, _self, args) => op(args[0], 'removed'));
    const appended = hookMethod(SBp, 'appendBuffer', (_r, self, args) => onAppend(self, args[0]));
    hookMethod(SBp, 'changeType', (_r, self, args) => {
      const info = buffers.get(self);
      if (!info) return;
      info.mime = String(args[0] ?? '').slice(0, LIMITS.mimeChars);
      Object.assign(info, classifyMime(info.mime));
      op(self, 'changeType', { mime: info.mime });
    });
    hookMethod(SBp, 'abort', (_r, self) => op(self, 'abort'));
    hookMethod(SBp, 'remove', (_r, self, args) => op(self, 'remove', { start: Number(args[0]), end: Number(args[1]) }));
    hookSetter(SBp, 'timestampOffset', (self, value) => op(self, 'timestampOffset', { value: Number(value) }));
    return added && appended;
  });

  const objectUrl = tryHook(() =>
    hookMethod(win.URL, 'createObjectURL', (url, _self, args) => {
      if (args[0] instanceof MS && typeof url === 'string') emit({ k: 'mse-source', msId: msIdOf(args[0]), url });
    })
  );

  return { mse, objectUrl };
}
