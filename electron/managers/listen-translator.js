// Listen-mode translation and transcript, in the main process (v0.5.0).
// Each final the recognizer produces is translated here — same stack, same
// privacy gate as every other translation — and streamed to the floating
// window as {id, text, done}; the window only paints. The session's
// transcript (finals + settled translations) lives here too, so the SRT
// that is filed when the session ends carries every translation that
// finished, whether or not a window was open to see it.
//
// Factory: the smoke and the unit test hand in a fake translateStream.

const { buildListenSystemPrompt } = require('../utils/listen-prompt');

// Full transcript kept for the subtitle file. A 2-hour film is ~2000
// lines (~400KB); the cap is a runaway backstop, not a budget.
const MAX_TRANSCRIPT = 20000;
// Chunks carry the full text so far; the window repaints at most ~10 times
// a second so a fast model does not turn every token into a commit.
const PAINT_EVERY_MS = 100;
// How long a session end waits for translations still streaming before the
// file is written without them.
const SETTLE_MS = 3000;

function pad(n, w) {
  return String(n).padStart(w, '0');
}

function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms % 1000, 3)}`;
}

// SRT text for the finals collected so far; a translation that settled
// rides under its line, an unsettled one is left out.
function buildSrt(finals) {
  const blocks = finals.map((seg, i) => {
    const lines = [seg.text];
    if (seg.trans && seg.trans !== 'pending') lines.push(seg.trans);
    return `${i + 1}\n${srtTime(seg.startS)} --> ${srtTime(seg.startS + seg.durS)}\n${lines.join('\n')}`;
  });
  return blocks.join('\n\n') + '\n';
}

// enabled: whether a translation stack is wired at all (the smoke harness
// runs without one — finals are still recorded and filed).
function createListenTranslator({ translateStream = null, enabled = () => !!translateStream, uiLang = () => 'zh', autosave = null, emit = () => {}, logger, now = Date.now, settleMs = SETTLE_MS, paintEveryMs = PAINT_EVERY_MS }) {
  let transcript = [];
  let truncated = false;
  let targetLang = '';
  let sourceName = '';
  let active = false;
  let nextId = 1;
  const inflight = new Map(); // id -> { controller, promise }

  function beginSession({ targetLang: target = '', sourceName: name = '' } = {}) {
    transcript = [];
    truncated = false;
    targetLang = typeof target === 'string' ? target : '';
    sourceName = typeof name === 'string' ? name : '';
    active = true;
  }

  function setTarget(lang) {
    targetLang = typeof lang === 'string' ? lang : '';
  }

  function settle(seg, text) {
    seg.trans = text;
    emit('translation', { id: seg.id, text, done: true });
  }

  async function translate(seg) {
    const target = targetLang;
    if (!target || !translateStream || !enabled()) return;
    const srcLang = (seg.lang || '').replace(/[<|>]/g, '');
    if (srcLang === target) return;
    seg.trans = 'pending';
    emit('translation', { id: seg.id, text: 'pending', done: false });
    // The two finals before this one, as context for the LLM prompt (MT
    // engines ignore the system prompt and translate the bare line).
    const idx = transcript.indexOf(seg);
    const context = idx > 0 ? transcript.slice(Math.max(0, idx - 2), idx).map((s) => s.text) : [];
    const systemPrompt = buildListenSystemPrompt({ targetLang: target, context, uiLang: uiLang() });
    const controller = new AbortController();
    let lastPaint = 0;
    const run = (async () => {
      try {
        const res = await translateStream(
          seg.text,
          { sourceLang: 'auto', targetLang: target, systemPrompt },
          (full) => {
            if (!full) return;
            const t = now();
            if (t - lastPaint < paintEveryMs) return;
            lastPaint = t;
            emit('translation', { id: seg.id, text: full, done: false });
          },
          // noCache: subtitle lines are one-shot — caching them would evict
          // the user's real translation cache. The privacy gate is the
          // facade's.
          { noCache: true, signal: controller.signal }
        );
        settle(seg, res?.success && res.text ? res.text : null);
      } catch (e) {
        logger?.warn?.(`listen translation failed: ${e.message}`);
        settle(seg, null);
      } finally {
        inflight.delete(seg.id);
      }
    })();
    inflight.set(seg.id, { controller, promise: run });
    await run;
  }

  // A final from the recognizer. Returns the record the window gets (with
  // its id); translation follows on the 'translation' stream.
  function onSegment(rec) {
    const seg = { id: nextId++, startS: rec.segStartS, durS: rec.segDurS, lang: rec.lang, text: rec.text, trans: null };
    if (active) {
      if (transcript.length >= MAX_TRANSCRIPT) truncated = true;
      else transcript.push(seg);
    }
    translate(seg).catch(() => {});
    return { ...rec, id: seg.id };
  }

  // Session over: give streaming translations a moment, then file the
  // transcript. Idempotent — a second call finds nothing to write.
  async function endSession(reason) {
    if (!active) return null;
    active = false;
    const finals = transcript.filter((s) => s.text);
    const name = sourceName;
    transcript = [];
    if (inflight.size) {
      await Promise.race([
        Promise.allSettled([...inflight.values()].map((e) => e.promise)),
        new Promise((r) => setTimeout(r, settleMs)),
      ]);
      for (const e of inflight.values()) e.controller.abort();
    }
    if (!finals.length || !autosave) return null;
    try {
      const filePath = await autosave(buildSrt(finals), name, { reason, truncated });
      if (filePath) emit('autosaved', { filePath, lines: finals.length, reason });
      return filePath;
    } catch (e) {
      logger?.warn?.(`subtitle autosave failed: ${e.message}`);
      return null;
    }
  }

  return {
    beginSession,
    setTarget,
    onSegment,
    endSession,
    status: () => ({ active, targetLang, sourceName, lines: transcript.length, inflight: inflight.size, truncated }),
  };
}

module.exports = { createListenTranslator, buildSrt, MAX_TRANSCRIPT };
