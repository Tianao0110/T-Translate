# TODOS

Forward-looking work clipboard. Git history / GitHub release notes are the archive — these notes stay concise (1-3 lines each + file:line links). Stale-check on each release; delete shipped items.

## v0.2.6 candidates

Goal: ship the OpenAI-compatible presets refactor + a bundle of UX fixes from real usage feedback. PR split below — all UX fixes are in UI/system layers and don't touch `src/providers/*`, so zero conflict with the main refactor.

### PR-main: OpenAI-compatible presets refactor

Merge OpenAI / DeepSeek / Ollama / LM Studio into 1 class + N presets. ~-400-500 LOC. ~10 pure-fn unit tests. Design doc at `~/.gstack/projects/Tianao0110-T-Translate/A6753-claude-upbeat-ride-design-20260511-161849.md`.

### PR-quickwins: four small fixes (~25 lines total)

- **Auto-updater doesn't launch installer.** [electron/utils/auto-updater.js:275](electron/utils/auto-updater.js:275) uses `exec()` without detaching; parent `app.quit()` 1500ms later may take the child down on Windows. Switch to `child_process.spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref()` or `shell.openPath()`. SmartScreen / unsigned-binary issues are separate (code-signing scope, not this fix).
- **ALT pass-through hint missing English.** [GlassTranslator/index.jsx:764](src/components/GlassTranslator/index.jsx:764) hardcoded `<span>穿透模式 (松开 Alt 退出)</span>`. Wrap in `t()`, add `glass.passThroughMode` key to both [zh.js](src/i18n/locales/zh.js) and [en.js](src/i18n/locales/en.js).
- **Glass target language doesn't sync from main.** One-way sync exists (glass→main), reverse missing. Main app changes only write to electron-store via [sync-to-electron.js:53](src/stores/sync-to-electron.js:53) — glass isn't notified. Fix: after debouncedSync on translation language, call `window.electron.glass.notifySettingsChanged()` (IPC already exists at [glass.js:245](electron/ipc/glass.js:245)). Glass on `SETTINGS_CHANGED` must clear cached translation and re-translate current content with the new language.
- **Task Manager shows Chinese process names.** HTML `<title>` hardcoded — Windows reads it as subprocess name in Task Manager. i18n switch can't affect it (static at load). Unify to unambiguous English: [glass.html:6](public/glass.html:6) `翻译玻璃窗` → `Glass`, [screenshot.html:5](public/screenshot.html:5) `截图选区` → `Screenshot`, [child-pane.html:6](public/child-pane.html:6) `子玻璃板` → `Child Pane`. [selection.html:6](public/selection.html:6) is already English.

### PR-langselector: unify language selector across panels

[DocumentTranslator/index.jsx:1035-1057](src/components/DocumentTranslator/index.jsx:1035) uses raw `<select className="dt-lang-select">` with its own CSS, doesn't match main TranslationPanel styling. Extract a shared `<LanguageSelector>` component, replace in DocumentTranslator + TranslationPanel + GlassTranslator.

### PR-ocr-onboarding: turn OCR error into actionable guidance

New users hit "OCR Error" in glass translate because default engine `llm-vision` is flagged `available: true` at [ocr.js:152](electron/ipc/ocr.js:152) but actually needs a running local LLM + vision model. Screenshot path already has smart error discrimination at [screenshot.js:130-148](electron/ipc/screenshot.js:130) (vision-not-supported / timeout / generic) — reuse it in the glass path. Error display gets a "Go to settings" button that jumps to the OCR settings page. Full onboarding wizard stays as v0.3 candidate.

### Investigate first — may or may not ship in v0.2.6

- **PDF selection translation flaky.** User hypothesis: works in read-only mode, fails on the read-only/editable boundary. Current implementation uses simulateCtrlC + clipboard read (v0.2.4 added 800ms poll + focus handling). Different PDF readers (Adobe / Foxit / Edge / SumatraPDF) may use different clipboard behavior across modes (system clipboard vs internal, focus stealing). Repro across readers first to narrow down before fixing.
- **Triple-click sometimes captures the dbl-clicked word instead of the paragraph.** Race condition between two concurrent `handleDelayedConfirm` calls:
  - 2nd mouseup → `needsDelayedConfirm: true` → [main.js:43](electron/main.js:43) starts confirm A with fixed `setTimeout(80ms)` (`A6753-claude` line 49).
  - User's 3rd click lands inside that 80ms window → 3rd mouseup starts confirm B (also 80ms).
  - A and B race; if A grabs the selection before the OS finishes extending it to a paragraph, user sees the double-clicked word.
  - Why intermittent: depends on user's click cadence (sub-80ms triple → word; over-80ms triple → paragraph).
  - Fix: add cancellation to `handleDelayedConfirm`. When a new mousedown with `isMultiClick=true` arrives while a confirm is pending, abort it; only the latest confirm survives. ~15-25 lines of plumbing (cancel token + check at the post-setTimeout boundary). Optionally tighten by waiting "until no new mousedown for 80ms" rather than fixed 80ms.
- **Glass window loses alwaysOnTop after refocus.** Starts fine; after switching to another app and clicking back, glass falls to the bottom of z-order — only returning to desktop reveals it. "Falls to the bottom" suggests `alwaysOnTop` state is being **cleared**, not that the priority is too low (a level-too-low window would still float above same-level windows, not sink under everything).
  - ❌ **Don't** elevate level to `'screen-saver'` like selection/screenshot windows do — user runs other always-on-top tools (notes / PiP / etc.) at default `'floating'` level, and glass clobbering them creates a worse problem than the current bug. Keep `'floating'`.
  - Investigation order:
    1. Grep for any code path that calls `setAlwaysOnTop(false)` on glass — possible regression where some action (pass-through toggle? settings change?) unintentionally clears it.
    2. Reproduce with DevTools open: log `glassWindow.isAlwaysOnTop()` on `blur` / `focus` / `show` events to see when state flips.
    3. If state survives but z-order still wrong, Electron has known intermittent `alwaysOnTop` failures on Windows — fix is to re-apply on `blur`: `glassWindow.setAlwaysOnTop(false); glassWindow.setAlwaysOnTop(true)` (toggle to force a Win32 SetWindowPos refresh, **stay at floating level**).

## v0.2.7 candidates

### Streaming render throttle (RAF + device tier)

Replace per-token `setState` on the `<textarea>` with RAF-based buffering: accumulate tokens, flush one batch per frame, minimum 16ms interval floor (cap at 60fps even on 144/240Hz displays). Two device tiers via `navigator.hardwareConcurrency` + `deviceMemory`: high (≥8 cores, ≥16GB) → 16ms floor, mid/low → 33ms floor. Non-streaming providers (Google/DeepL/Baidu) bypass the throttle. Flush residual buffer on stream end.

Project has no markdown rendering — translation output is a raw `<textarea>`. Expected peak memory reduction is ~1.5-2x on low-end (not the 5-10x you'd see in markdown apps). Verification artifact: before/after Memory snapshots. Depends on v0.2.6 shipping.

## v0.3 candidates

### "按下没内容" auto-detect path: text caching root-fix

v0.2.4 mitigated the symptom with an 800ms poll extension. True root cause is focus transfer: icon shows → user clicks icon → focus jumps from target app to icon window → simulateCtrlC fires at a now-defocused target → fails. Proper fix: cache successfully-fetched text + timestamp to `runtime.lastSelectionText` in the Layer 3 clipboard path; on subsequent `SELECTION.GET_TEXT` requests, use cache if <500ms old. Need to calibrate invalidation strategy (clear on mouseup? idle? new selection?).

### Full onboarding wizard

The v0.2.6 OCR error-to-guidance fix is the short version. Full version: first-launch welcome flow, guided OCR/LLM setup, feature tour. Needs design.

### Incremental unit test coverage buildout

`tests/setup.js` exists since v0.2.4. Principle: add tests when you touch a file, new features must ship with tests, bug fixes must ship with regression tests. Not chasing 100% coverage.
