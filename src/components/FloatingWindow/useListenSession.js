// Listen-translate session state machine for the floating window.
//
// Capture is NOT here any more (v0.4.1): the native WASAPI layer inside the
// audio worker pulls 16 kHz mono float32 straight into the VAD, which removed
// this file's getDisplayMedia call, its 48k→16k resampler, its PCM streaming,
// and the device-loss retry loop (the audio client reports an invalidated
// device explicitly, so the worker rebuilds it and just says so).
//
// What is left: session control, finals/partial state, the capture level fed
// from the worker, per-final translation through the main-process stack
// (privacy injected there), and SRT export assembly.

import { useCallback, useEffect, useRef, useState } from 'react';
import i18n from 'i18next';
import createLogger from '../../utils/logger.js';
import stackClient from '../../services/stack-client.js';
import { normalizeDraftCase } from '../../utils/listen-text.js';
import { buildListenSystemPrompt } from '../../utils/listen-prompt.js';

const logger = createLogger('ListenSession');

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
  // 0..1 capture level, updated straight from the audio callback (see below).
  const levelRef = useRef(0);
  const [ttsGated, setTtsGated] = useState(false);
  const [partial, setPartial] = useState('');
  const [available, setAvailable] = useState(false);

  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem('listenLang') || ''; } catch { return ''; }
  });
  const [targetLang, setTargetLangState] = useState(() => {
    try { return localStorage.getItem('listenTargetLang') || ''; } catch { return ''; }
  });

  const runningRef = useRef(false);
  const engineReadyRef = useRef(false);
  const errorLatchRef = useRef(false);
  const pendingRestartRef = useRef(false);
  // 'source-gone' is followed within milliseconds by 'listening' (the worker
  // re-opens whole-system capture in place); hold the notice up long enough
  // to be read.
  const sourceGoneUntilRef = useRef(0);
  const langRef = useRef(lang);
  const targetLangRef = useRef(targetLang);
  // {mode:'system'|'include'|'exclude', pid, name} — which sound to listen to.
  // Deliberately NOT persisted: a pid is only meaningful while that program is
  // running, and silently listening to whatever inherited the number next
  // launch would be worse than starting from "whole system" every time.
  const [source, setSourceState] = useState({ mode: 'system', pid: 0, name: '' });
  const sourceRef = useRef(source);
  // What this machine can do + which programs are currently making sound.
  const [sources, setSources] = useState({ supported: false, processLoopback: false, sessions: [] });

  const setLang = useCallback((value) => {
    setLangState(value);
    langRef.current = value;
    try { localStorage.setItem('listenLang', value); } catch { /* storage off */ }
    // Language switch mid-session restarts the worker (the language is baked
    // into the recognizer config); capture restarts with it.
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

  // Switching source mid-session restarts the worker's capture in place; the
  // engine and its models stay loaded.
  const setSource = useCallback((next) => {
    const mode = ['system', 'include', 'exclude'].includes(next?.mode) ? next.mode : 'system';
    const pid = Number.isInteger(next?.pid) && next.pid > 0 ? next.pid : 0;
    // A pid carried under 'system' is a contradiction waiting to be read by
    // the next person: whole-system capture targets no process at all.
    const value = mode === 'system'
      ? { mode: 'system', pid: 0, name: '' }
      : { mode, pid, name: typeof next?.name === 'string' ? next.name : '' };
    if (value.mode !== 'system' && !value.pid) return;
    setSourceState(value);
    sourceRef.current = value;
    if (runningRef.current) {
      pendingRestartRef.current = true;
      engineReadyRef.current = false;
      setPartial('');
      setSessionState('loading');
      window.electron?.audioEngine?.stop?.();
    }
  }, []);

  const refreshSources = useCallback(async () => {
    try {
      const res = await window.electron?.audioEngine?.listSources?.();
      if (res) setSources(res);
    } catch {
      // probe failure just leaves the previous list in place
    }
  }, []);

  // ===== session control =====

  const start = useCallback(() => {
    runningRef.current = true;
    setRunning(true);
    engineReadyRef.current = false;
    errorLatchRef.current = false;
    pendingRestartRef.current = false;
    setSegments([]);
    transcriptRef.current = [];
    transcriptTruncatedRef.current = false;
    setPartial('');
    window.electron?.audioEngine?.start?.({
      language: langRef.current,
      source: sourceRef.current,
    });
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    engineReadyRef.current = false;
    levelRef.current = 0; // the meter must not freeze on the last loud frame
    setPartial('');
    window.electron?.audioEngine?.stop?.();
  }, []);

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
    // The two finals before this one, as context for the LLM prompt (MT
    // engines ignore the system prompt and translate the bare line).
    const arr = transcriptRef.current;
    let idx = arr.length - 1;
    while (idx >= 0 && arr[idx].id !== segId) idx--;
    const context = idx > 0 ? arr.slice(Math.max(0, idx - 2), idx).map((s) => s.text) : [];
    const systemPrompt = buildListenSystemPrompt({ targetLang: target, context, uiLang: i18n.language });
    // Chunks carry the full text so far; paint them at most ~10 times a second
    // so a fast model does not turn every token into a React commit.
    let lastPaint = 0;
    const paint = (text) => {
      const now = Date.now();
      if (now - lastPaint < 100) return;
      lastPaint = now;
      setSegments((prev) => prev.map((s) => (s.id === segId ? { ...s, trans: text } : s)));
    };
    try {
      const res = await stackClient.translateStream(
        rec.text,
        { sourceLang: 'auto', targetLang: target, systemPrompt },
        (full) => { if (full) paint(full); },
        // supersede off: lines translate concurrently and never abort each
        // other. noCache: subtitle lines are one-shot — caching them evicts
        // the user's real translation cache (200 entries, shared) and rewrites
        // the cache file every couple of seconds. The flag can only ever
        // REDUCE caching; the secure-mode gate lives in the main-process facade.
        { supersede: false, noCache: true }
      );
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

    const offStatus = bridge.onStatus((payload) => {
      const { state, detail } = payload || {};
      if (state === 'metrics') return;
      if (state === 'listening') engineReadyRef.current = true;
      if (state === 'source-gone') {
        // The manager already fell back to whole-system capture; mirror it in
        // the picker without the restart a user-driven switch triggers.
        const value = { mode: 'system', pid: 0, name: '' };
        setSourceState(value);
        sourceRef.current = value;
        sourceGoneUntilRef.current = Date.now() + 5000;
      }
      if (state === 'listening' && Date.now() < sourceGoneUntilRef.current) return;
      // The worker owns capture now, so a failure to open the audio client
      // arrives as a status instead of a rejected promise here.
      if (state === 'capture-error') {
        window.electron?.logs?.write?.({ level: 'error', message: `listen capture failed: ${detail || ''}` });
        errorLatchRef.current = true;
      }
      if (state === 'stopped' && pendingRestartRef.current && runningRef.current) {
        pendingRestartRef.current = false;
        window.electron?.audioEngine?.start?.({
          language: langRef.current,
          source: sourceRef.current,
        });
        return; // status stays 'loading'
      }
      if (state === 'stopped' || state === 'engine-dead' || state === 'model-load-failed'
          || state === 'secure-blocked' || state === 'capture-error') {
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

    const offPartial = bridge.onPartial((text) => setPartial(normalizeDraftCase(text || '')));
    // Level arrives from the worker at ~12/s and lands in a ref: the meter
    // paints itself from a rAF loop, so this never re-renders the transcript.
    const offLevel = bridge.onLevel?.((value) => {
      levelRef.current = typeof value === 'number' ? value : 0;
    });
    // Mute gate mirror: while any window plays TTS the worker drops capture;
    // the status strip says so and the meter rests at zero.
    const offGate = bridge.onTtsGate?.((on) => {
      setTtsGated(on);
      if (on) levelRef.current = 0;
    });

    return () => {
      offStatus?.();
      offSegment?.();
      offPartial?.();
      offLevel?.();
      offGate?.();
    };
  }, [active, stop, translateSegment]);

  // The picker can only list programs that already opened an audio stream, so
  // the list is kept fresh while the user is choosing and left alone once the
  // session runs (nothing in it can change what is already being captured).
  useEffect(() => {
    if (!active || running) return undefined;
    refreshSources();
    const timer = setInterval(refreshSources, 4000);
    return () => clearInterval(timer);
  }, [active, running, refreshSources]);

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
    source,
    setSource,
    sources,
    refreshSources,
    toggle,
    stop,
    exportSrt,
    levelRef,
    ttsGated,
  };
}
