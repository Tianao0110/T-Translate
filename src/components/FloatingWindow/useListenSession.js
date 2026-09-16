// Listen-translate session state machine for the floating window: session
// control, finals / partial state, the capture level fed from the worker,
// and SRT export assembly. Capture and translation live in the main process.

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeDraftCase } from '../../listen/listen-text.js';

// On-screen scrollback (live DOM).
const MAX_SEGMENTS = 100;

// Source-list cadence: a burst right after a session starts, then slowly,
// then not at all until a hover on the toolbar.
const SOURCES_BURST_MS = 10000;
const SOURCES_BURST_EVERY_MS = 2500;
const SOURCES_EVERY_MS = 8000;
const SOURCES_IDLE_EVERY_MS = 4000;
const SOURCES_STOP_AFTER_MS = 180000;

// Translation, transcript and subtitle file are the main process's
// (listen/listen-translator.js); this hook shows a window of finals.
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
  // 'source-gone' is followed within milliseconds by 'listening'; hold the
  // notice up long enough to be read.
  const sourceGoneUntilRef = useRef(0);
  const langRef = useRef(lang);
  const targetLangRef = useRef(targetLang);
  // {mode:'system'|'include'|'exclude', pid, name} — which sound to listen
  // to. Not persisted (a pid is only meaningful while that program runs).
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

  // Mid-session switch: the worker restarts with the new config, the main
  // process files the finals so far and the view starts over.
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
    // Language switch mid-session restarts the worker.
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
    // Whole-system capture carries no pid.
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
    // Level lands in a ref; the meter paints itself from a rAF loop.
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

  // Source refresh schedule while running (SOURCES_* constants).
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

  // Leaving listen mode (or unmounting the window) force-stops the session;
  // the main-process once('closed') listener backstops a hard window close.
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
