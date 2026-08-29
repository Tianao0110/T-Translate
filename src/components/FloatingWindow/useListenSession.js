// Listen-translate session hook: the audio-probe page's capture pipeline and
// session state machine, ported into the floating window's listen mode.
//
// Owns: loopback capture (getDisplayMedia resolved by the main-process session
// handler), 48k→16k resample, PCM streaming to the audio-engine worker,
// finals/partial state, per-final translation via the main-process stack
// (privacy injected there), and SRT export assembly.
//
// Iron rule carried over: echo cancellation / noise suppression / auto gain
// MUST stay off — AEC's reference signal IS the machine's own playback, so it
// would cancel the entire loopback stream (spike-verified all-zeros).

import { useCallback, useEffect, useRef, useState } from 'react';
import createLogger from '../../utils/logger.js';

const logger = createLogger('ListenSession');

const TARGET_RATE = 16000;
const SEND_BATCH = 3200; // 200ms at 16k
// On-screen scrollback. Small on purpose: every kept segment is live DOM, and
// nobody scrolls back an hour in a subtitle overlay.
const MAX_SEGMENTS = 100;
// Full transcript kept for SRT export, in a ref — no re-render, no DOM. A
// 2-hour film is ~2000 lines (~400KB); the cap is a runaway backstop, not a
// budget, and is announced when it bites rather than silently dropping lines.
const MAX_TRANSCRIPT = 20000;

let nextSegId = 1;

export default function useListenSession({ active }) {
  const [sessionState, setSessionState] = useState('idle');
  const [running, setRunning] = useState(false);
  const [segments, setSegments] = useState([]);
  // Export reads this, not `segments`: the visible list is a 100-line window,
  // and exporting a two-hour session used to hand back only its tail.
  const transcriptRef = useRef([]);
  const transcriptTruncatedRef = useRef(false);
  const [partial, setPartial] = useState('');
  const [available, setAvailable] = useState(false);

  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem('listenLang') || ''; } catch { return ''; }
  });
  const [targetLang, setTargetLangState] = useState(() => {
    try { return localStorage.getItem('listenTargetLang') || ''; } catch { return ''; }
  });

  const captureRef = useRef(null); // {stream, ctx, src, proc, mute, track}
  const runningRef = useRef(false);
  const engineReadyRef = useRef(false);
  const reacquireRef = useRef(0);
  const errorLatchRef = useRef(false);
  const pendingRestartRef = useRef(false);
  const langRef = useRef(lang);
  const targetLangRef = useRef(targetLang);

  const setLang = useCallback((value) => {
    setLangState(value);
    langRef.current = value;
    try { localStorage.setItem('listenLang', value); } catch { /* storage off */ }
    // Language switch mid-session restarts the worker; capture keeps running
    // (PCM is dropped main-process side while the engine reloads), dodging a
    // second getDisplayMedia user-gesture requirement.
    if (runningRef.current) {
      pendingRestartRef.current = true;
      engineReadyRef.current = false;
      setPartial('');
      setSessionState('loading');
      window.electron?.audioEngine?.stop?.();
    }
  }, []);

  const setTargetLang = useCallback((value) => {
    setTargetLangState(value);
    targetLangRef.current = value;
    try { localStorage.setItem('listenTargetLang', value); } catch { /* storage off */ }
  }, []);

  // ===== capture pipeline (probe-page port) =====

  const stopCapture = useCallback(() => {
    const c = captureRef.current;
    if (!c) return;
    captureRef.current = null;
    try { c.track.removeEventListener('ended', c.onEnded); } catch { /* gone */ }
    try { c.proc.disconnect(); c.src.disconnect(); c.mute.disconnect(); } catch { /* gone */ }
    try { c.stream.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
    try { c.ctx.close(); } catch { /* gone */ }
  }, []);

  const startCapture = useCallback(async (onDeviceLost) => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    stream.getVideoTracks().forEach((t) => t.stop());
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('no audio track');
    }

    const ctx = new AudioContext();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 2, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;

    const step = ctx.sampleRate / TARGET_RATE;
    let pos = 0;
    let prevSample = 0;
    let outBuf = new Float32Array(SEND_BATCH);
    let outLen = 0;

    proc.onaudioprocess = (e) => {
      const ch0 = e.inputBuffer.getChannelData(0);
      const ch1 = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : ch0;
      const n = ch0.length;
      // linear-interp resample with carry across callbacks
      while (pos < n) {
        const i = Math.floor(pos);
        const frac = pos - i;
        const s0 = i === 0 ? prevSample : (ch0[i - 1] + ch1[i - 1]) * 0.5;
        const s1 = (ch0[i] + ch1[i]) * 0.5;
        outBuf[outLen++] = s0 + (s1 - s0) * frac;
        if (outLen === SEND_BATCH) {
          window.electron?.audioEngine?.sendPcm?.(outBuf);
          outBuf = new Float32Array(SEND_BATCH);
          outLen = 0;
        }
        pos += step;
      }
      pos -= n;
      prevSample = (ch0[n - 1] + ch1[n - 1]) * 0.5;
    };

    src.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);

    const onEnded = () => onDeviceLost();
    track.addEventListener('ended', onEnded);
    captureRef.current = { stream, ctx, src, proc, mute, track, onEnded };
  }, []);

  // ===== session control =====

  const start = useCallback(() => {
    runningRef.current = true;
    setRunning(true);
    engineReadyRef.current = false;
    reacquireRef.current = 0;
    errorLatchRef.current = false;
    pendingRestartRef.current = false;
    setSegments([]);
    transcriptRef.current = [];
    transcriptTruncatedRef.current = false;
    setPartial('');
    window.electron?.audioEngine?.start?.({ language: langRef.current });
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    engineReadyRef.current = false;
    stopCapture();
    setPartial('');
    window.electron?.audioEngine?.stop?.();
  }, [stopCapture]);

  // Default output device switches kill the loopback stream — rebuild it.
  const onDeviceLost = useCallback(async () => {
    if (!runningRef.current) return;
    window.electron?.audioEngine?.sendEvent?.('device-lost');
    setSessionState('device-lost');
    stopCapture();
    reacquireRef.current += 1;
    await new Promise((r) => setTimeout(r, 1200));
    if (!runningRef.current) return;
    try {
      await startCapture(onDeviceLost);
      window.electron?.audioEngine?.sendEvent?.('device-reacquired');
      if (engineReadyRef.current) setSessionState('listening');
    } catch (err) {
      window.electron?.audioEngine?.sendEvent?.('reacquire-failed', String(err));
      if (reacquireRef.current < 3) {
        onDeviceLost();
      } else {
        setSessionState('reacquire-failed');
        stop();
      }
    }
  }, [startCapture, stopCapture, stop]);

  const toggle = useCallback(() => {
    if (runningRef.current) stop();
    else start();
  }, [start, stop]);

  // ===== per-final translation (finals only — the contract) =====

  // Writes the settled translation into the export transcript as well as the
  // visible list. Scans from the tail: a translation lands seconds after its
  // segment, so the match is the last entry in practice.
  const settleTrans = useCallback((segId, trans) => {
    const arr = transcriptRef.current;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].id === segId) {
        arr[i].trans = trans;
        break;
      }
    }
    setSegments((prev) => prev.map((s) => (s.id === segId ? { ...s, trans } : s)));
  }, []);

  const translateSegment = useCallback(async (segId, rec) => {
    const target = targetLangRef.current;
    if (!target) return;
    const srcLang = (rec.lang || '').replace(/[<|>]/g, '');
    if (srcLang === target) return;
    setSegments((prev) => prev.map((s) => (s.id === segId ? { ...s, trans: 'pending' } : s)));
    try {
      const res = await window.electron?.stack?.translate?.({
        text: rec.text,
        // Subtitle lines are one-shot: caching them evicts the user's real
        // translation cache (200 entries, shared) and rewrites the cache file
        // every couple of seconds for content nobody translates twice. This
        // flag can only ever REDUCE caching — the privacy gate that turns it
        // off in secure mode still lives in the main-process facade.
        noCache: true,
        options: { sourceLang: 'auto', targetLang: target },
      });
      settleTrans(segId, res?.success && res.text ? res.text : null);
    } catch {
      settleTrans(segId, null);
    }
  }, [settleTrans]);

  // ===== engine event wiring (only while listen mode is active) =====

  useEffect(() => {
    if (!active) return undefined;
    const bridge = window.electron?.audioEngine;
    if (!bridge) return undefined;

    bridge.getInfo().then((info) => {
      setAvailable(!!info?.modelName && !info?.secureBlocked);
      if (info?.secureBlocked) setSessionState('secure-blocked');
    }).catch(() => setAvailable(false));

    const offStatus = bridge.onStatus(async (payload) => {
      const { state } = payload || {};
      if (state === 'metrics') return;
      if (state === 'listening' && runningRef.current && !captureRef.current) {
        engineReadyRef.current = true;
        try {
          await startCapture(onDeviceLost);
          setSessionState('listening');
        } catch (err) {
          window.electron?.logs?.write?.({ level: 'error', message: `listen capture failed: ${err}` });
          errorLatchRef.current = true;
          setSessionState('capture-error');
          stop();
        }
        return;
      }
      if (state === 'listening') engineReadyRef.current = true;
      if (state === 'stopped' && pendingRestartRef.current && runningRef.current) {
        pendingRestartRef.current = false;
        window.electron?.audioEngine?.start?.({ language: langRef.current });
        return; // status stays 'loading'
      }
      if (state === 'stopped' || state === 'engine-dead' || state === 'secure-blocked') {
        if (runningRef.current && state !== 'stopped') stop();
        if (state === 'stopped') {
          runningRef.current = false;
          setRunning(false);
          if (errorLatchRef.current) return; // keep the error text visible
        }
      }
      setSessionState(state);
    });

    const offSegment = bridge.onSegment((rec) => {
      const id = nextSegId++;
      const seg = { id, startS: rec.segStartS, durS: rec.segDurS, lang: rec.lang, text: rec.text, repeated: rec.repeated, trans: null };
      if (transcriptRef.current.length >= MAX_TRANSCRIPT) transcriptTruncatedRef.current = true;
      else transcriptRef.current.push(seg);
      setSegments((prev) => {
        const next = [...prev, seg];
        return next.length > MAX_SEGMENTS ? next.slice(next.length - MAX_SEGMENTS) : next;
      });
      setPartial('');
      translateSegment(id, rec);
    });

    const offPartial = bridge.onPartial((text) => setPartial(text || ''));

    return () => {
      offStatus?.();
      offSegment?.();
      offPartial?.();
    };
  }, [active, startCapture, stopCapture, onDeviceLost, stop, translateSegment]);

  // Leaving listen mode (or unmounting the window) force-stops the session —
  // the engine must never hum without its host UI (zero-idle rule). The
  // main-process once('closed') listener backstops a hard window close.
  useEffect(() => {
    if (!active && runningRef.current) {
      stop();
      setSessionState('idle');
    }
  }, [active, stop]);
  useEffect(() => () => {
    if (runningRef.current) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== SRT export =====

  // Exports the whole session, not the visible window, and works mid-recording:
  // it writes the finals collected so far. The in-flight draft line is not a
  // final and never lands in the file.
  const exportSrt = useCallback(async () => {
    const finals = transcriptRef.current.filter((s) => s.text);
    if (!finals.length) return { success: false, error: 'empty' };
    const pad = (n, w) => String(n).padStart(w, '0');
    const ts = (sec) => {
      const ms = Math.max(0, Math.round(sec * 1000));
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms % 1000, 3)}`;
    };
    const blocks = finals.map((seg, i) => {
      const lines = [seg.text];
      if (seg.trans && seg.trans !== 'pending') lines.push(seg.trans);
      return `${i + 1}\n${ts(seg.startS)} --> ${ts(seg.startS + seg.durS)}\n${lines.join('\n')}`;
    });
    const res = await window.electron?.audioEngine?.exportSrt?.(blocks.join('\n\n') + '\n');
    return res?.success ? { ...res, truncated: transcriptTruncatedRef.current } : res;
  }, []);

  return {
    sessionState,
    running,
    segments,
    partial,
    available,
    lang,
    setLang,
    targetLang,
    setTargetLang,
    toggle,
    stop,
    exportSrt,
  };
}
