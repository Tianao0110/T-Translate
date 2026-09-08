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
import createLogger from '../../utils/logger.js';
import { normalizeDraftCase } from '../../utils/listen-text.js';

const logger = createLogger('ListenSession');

// On-screen scrollback. Small on purpose: every kept segment is live DOM, and
// nobody scrolls back an hour in a subtitle overlay.
const MAX_SEGMENTS = 100;

// Source-list cadence. The picker can only show programs that already opened
// an audio stream, so it is refreshed in a burst right after a session starts
// (pressing play usually comes next), then slowly, and not at all once the
// window has been left alone — a hover on the toolbar wakes it up again.
const SOURCES_BURST_MS = 10000;
const SOURCES_BURST_EVERY_MS = 2500;
const SOURCES_EVERY_MS = 8000;
const SOURCES_IDLE_EVERY_MS = 4000;
const SOURCES_STOP_AFTER_MS = 180000;

// Translation, the session transcript and the subtitle file are the main
// process's (managers/listen-translator.js): this hook shows a 100-line
// window of finals with whatever translation has arrived for each.
export default function useListenSession({ active, onAutosaved }) {
  const [sessionState, setSessionState] = useState('idle');
  const [running, setRunning] = useState(false);
  const [segments, setSegments] = useState([]);
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
  // Last moment the user "touched" the picker's world (session start, a
  // switch, a hover); the refresh schedule stops SOURCES_STOP_AFTER_MS later.
  const sourcesActivityRef = useRef(0);
  const [sourcesTick, setSourcesTick] = useState(0);
  const onAutosavedRef = useRef(onAutosaved);
  onAutosavedRef.current = onAutosaved;

  const bumpSourcesActivity = useCallback(() => {
    sourcesActivityRef.current = Date.now();
    setSourcesTick((n) => n + 1);
  }, []);

  const resetView = useCallback(() => {
    setSegments([]);
    setPartial('');
  }, []);

  // Mid-session switch: the worker restarts with the new config. The main
  // process files the finals so far and the view starts over, exactly as
  // stop + start would — the new worker's clock starts at zero, so old and
  // new lines could not share a timeline anyway.
  const restartSession = useCallback(() => {
    resetView();
    pendingRestartRef.current = true;
    engineReadyRef.current = false;
    setSessionState('loading');
    window.electron?.audioEngine?.stop?.();
  }, [resetView]);

  const setLang = useCallback((value) => {
    setLangState(value);
    langRef.current = value;
    try { localStorage.setItem('listenLang', value); } catch { /* storage off */ }
    // Language switch mid-session restarts the worker (the language is baked
    // into the recognizer config); capture restarts with it.
    bumpSourcesActivity();
    if (runningRef.current) restartSession();
  }, [bumpSourcesActivity, restartSession]);

  const setTargetLang = useCallback((value) => {
    setTargetLangState(value);
    targetLangRef.current = value;
    try { localStorage.setItem('listenTargetLang', value); } catch { /* storage off */ }
    // Applies to the next finals of a running session; the translator
    // lives in the main process.
    window.electron?.audioEngine?.setTarget?.(value);
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
    bumpSourcesActivity();
    if (runningRef.current) restartSession();
  }, [bumpSourcesActivity, restartSession]);

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
    resetView();
    sourcesActivityRef.current = Date.now();
    window.electron?.audioEngine?.start?.({
      language: langRef.current,
      targetLang: targetLangRef.current,
      source: sourceRef.current,
    });
  }, [resetView]);

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
          targetLang: targetLangRef.current,
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

    // Finals arrive numbered by the main process; their translations follow
    // on the translation channel keyed by that id ('pending', then the text
    // so far, then the settled text or null).
    const offSegment = bridge.onSegment((rec) => {
      const seg = { id: rec.id, startS: rec.segStartS, durS: rec.segDurS, lang: rec.lang, text: rec.text, repeated: rec.repeated, trans: null };
      setSegments((prev) => {
        const next = [...prev, seg];
        return next.length > MAX_SEGMENTS ? next.slice(next.length - MAX_SEGMENTS) : next;
      });
      setPartial('');
    });
    const offTranslation = bridge.onTranslation?.(({ id, text }) => {
      setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, trans: text } : s)));
    });
    const offAutosaved = bridge.onAutosaved?.((result) => onAutosavedRef.current?.(result));

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
      offTranslation?.();
      offAutosaved?.();
      offPartial?.();
      offLevel?.();
      offGate?.();
    };
  }, [active, stop]);

  // A program that starts playing after the session began must still be
  // pickable (switching mid-session is supported), hence the running-state
  // schedule; see the SOURCES_* constants for the cadence.
  useEffect(() => {
    if (!active) return undefined;
    const startedAt = Date.now();
    sourcesActivityRef.current = Math.max(sourcesActivityRef.current, startedAt);
    let timer = null;
    let cancelled = false;
    const schedule = () => {
      if (cancelled || Date.now() - sourcesActivityRef.current >= SOURCES_STOP_AFTER_MS) return;
      const delay = !running
        ? SOURCES_IDLE_EVERY_MS
        : Date.now() - startedAt < SOURCES_BURST_MS
          ? SOURCES_BURST_EVERY_MS
          : SOURCES_EVERY_MS;
      timer = setTimeout(async () => {
        await refreshSources();
        schedule();
      }, delay);
    };
    refreshSources().then(schedule);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, running, sourcesTick, refreshSources]);

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
    bumpSourcesActivity,
    levelRef,
    ttsGated,
  };
}
